/**
 * 阶梯定价 + Agent 门槛 + 提案制 回归测试
 */
const { ethers } = require("ethers");
const ganache = require("ganache");
const coreArt = require("../artifacts/CityCore.json");
const tokenArt = require("../artifacts/AgentToken.json");
const nftArt = require("../artifacts/MinerNFT.json");

let pass = 0, fail = 0;
const ok = (n, c, e = "") => {
  if (c) { pass++; console.log("  \x1b[32m✓\x1b[0m " + n + (e ? "  \x1b[90m" + e + "\x1b[0m" : "")); }
  else { fail++; console.log("  \x1b[31m✗\x1b[0m " + n + (e ? "  \x1b[90m" + e + "\x1b[0m" : "")); }
};
const sec = (t) => console.log("\n\x1b[36m━━ " + t + " ━━\x1b[0m");
const G = { gasLimit: 2000000 };
const BNB = (x) => ethers.parseEther(String(x));

// 带 balanceOf + ownerOfHandle 的注册表 mock
const REG_ABI = [
  "function set(string h, address a) external",
  "function ownerOfHandle(string h) view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function mintAgent(address to) external",
  "function ownerOfHandleRaw(string h) view returns (address)",
];
const REG_BYTECODE = null; // 用内联 Solidity 编译太麻烦，改用简单 ERC721 mock 由测试注入

(async () => {
  const eip = ganache.provider({ logging: { quiet: true }, chain: { chainId: 56 }, wallet: { totalAccounts: 10, defaultBalance: 10000 }, miner: { blockGasLimit: 30000000 } });
  const provider = new ethers.BrowserProvider(eip);
  const s = [];
  for (let i = 0; i < 10; i++) s.push(await provider.getSigner(i));

  const dep = async (art, args = []) => {
    const c = await new ethers.ContractFactory(art.abi, art.bytecode, s[0]).deploy(...args);
    await c.waitForDeployment();
    return c;
  };

  const token = await dep(tokenArt);
  const nft = await dep(nftArt);

  // 用 Node 编译一个最小注册表（balanceOf + ownerOfHandle）
  const solc = require("solc");
  const src = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract TestRegistry {
    mapping(string => address) public ownerOfHandle;
    mapping(address => uint256) public balanceOf;
    function set(string calldata h, address a) external { ownerOfHandle[h] = a; }
    function grant(address a) external { balanceOf[a] = 1; }
}`;
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity",
    sources: { "R.sol": { content: src } },
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  })));
  const art = out.contracts["R.sol"].TestRegistry;
  const reg = await new ethers.ContractFactory(art.abi, "0x" + art.evm.bytecode.object, s[0]).deploy();
  await reg.waitForDeployment();

  const core = await dep(coreArt, [await token.getAddress(), await nft.getAddress(), await reg.getAddress(), await s[9].getAddress()]);
  await (await token.setMinter(await core.getAddress())).wait();
  await (await nft.setCore(await core.getAddress())).wait();

  // ══════════ 定价阶梯 ══════════
  sec("阶梯定价参数");
  ok("首档价 0.001", (await core.BASE_MINT_PRICE()) === BNB("0.001"), ethers.formatEther(await core.BASE_MINT_PRICE()));
  ok("档位大小 1000", (await core.MINT_STEP_SIZE()) === 1000n);
  ok("每档递增 0.001", (await core.MINT_STEP_AMOUNT()) === BNB("0.001"));
  ok("封顶 0.05", (await core.MINT_PRICE_CAP()) === BNB("0.05"));

  sec("priceAt 边界");
  const cases = [
    [0, "0.001"], [1, "0.001"], [999, "0.001"], [1000, "0.002"],
    [1999, "0.002"], [2000, "0.003"], [9999, "0.01"], [10000, "0.011"], [49000, "0.05"],
    [100000, "0.05"],
  ];
  for (const [n2, want] of cases) {
    const got = await core.priceAt(n2);
    ok("priceAt(" + n2 + ") = " + want, got === BNB(want), ethers.formatEther(got));
  }

  // ══════════ Agent 门槛 ══════════
  sec("Agent ID 门槛");
  await (await core.setMintOpen(true, G)).wait();

  // 只发交易，不动注册表
  const mint = async (signer, handle) => {
    try {
      await (await core.connect(signer).mintMiner(handle, { value: BNB("0.001"), ...G })).wait();
      return "ok";
    } catch (e) { return (e.shortMessage || e.message || "").slice(0, 34); }
  };
  const claim = async (handle, owner) => {
    await (await reg.set(handle, owner, G)).wait();
  };

  // 1) 无 Agent ID（但 handle 归自己）→ 应被 NotAgent 拒绝
  await claim("alice", await s[1].getAddress());
  const r1 = await mint(s[1], "alice");
  ok("无 Agent ID 被拒", r1 !== "ok", r1);

  // 2) 授予 Agent ID 后可铸
  await (await reg.grant(await s[1].getAddress(), G)).wait();
  const r2 = await mint(s[1], "alice");
  ok("有 Agent ID 可铸", r2 === "ok", r2);

  // 3) 名字被 s[2] 认领，s[3] 有 Agent ID 但用这个名字 → 应被拒
  await (await reg.grant(await s[2].getAddress(), G)).wait();
  await (await reg.grant(await s[3].getAddress(), G)).wait();
  await claim("taken", await s[2].getAddress());
  const r3 = await mint(s[3], "taken");
  ok("名字被别人认领时被拒", r3 !== "ok", r3);

  // 4) 未注册的名字，s[3] 可自由使用
  const r4 = await mint(s[3], "freename");
  ok("未注册的名字可用", r4 === "ok", r4);

  sec("阶梯在链上生效");
  ok("矿机数 = 2", (await core.minerCount()) === 2n, "实际 " + (await core.minerCount()));
  ok("当前价仍 0.001", (await core.mintPrice()) === BNB("0.001"));

  // ══════════ 注册表提案制 ══════════
  sec("注册表提案 + 48h 时间锁");
  const before = await core.registry();
  await (await core.proposeRegistry(await s[8].getAddress(), G)).wait();
  ok("提案后注册表未变", (await core.registry()) === before);

  let early = false;
  try { await (await core.applyRegistry(G)).wait(); } catch { early = true; }
  ok("48h 内不能 apply", early);

  ok("时间锁 = 48h", (await core.REGISTRY_TIMELOCK()) === 172800n);
  ok("pendingRegistry 已记录", (await core.pendingRegistry()) === (await s[8].getAddress()));

  // 时间快进
  await provider.send("evm_increaseTime", [172801]);
  await provider.send("evm_mine", []);
  await (await core.applyRegistry(G)).wait();
  ok("48h 后可 apply", (await core.registry()) === (await s[8].getAddress()));

  console.log("\n\x1b[1m结果：" + pass + " 通过 / " + fail + " 失败\x1b[0m");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", (e.shortMessage || e.message || e).slice ? (e.shortMessage || e.message) : e); process.exit(1); });
