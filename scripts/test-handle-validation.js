/**
 * handle 字符集校验回归
 */
const { ethers } = require("ethers");
const ganache = require("ganache");
const coreArt = require("../artifacts/CityCore.json");
const tokenArt = require("../artifacts/AgentToken.json");
const nftArt = require("../artifacts/MinerNFT.json");
const regArt = require("../artifacts/MockRegistry.json");

let pass = 0, fail = 0;
const ok = (n, c, e = "") => {
  if (c) { pass++; console.log("  \x1b[32m✓\x1b[0m " + n + (e ? "  \x1b[90m" + e + "\x1b[0m" : "")); }
  else { fail++; console.log("  \x1b[31m✗\x1b[0m " + n + (e ? "  \x1b[90m" + e + "\x1b[0m" : "")); }
};
const sec = (t) => console.log("\n\x1b[36m━━ " + t + " ━━\x1b[0m");
const G = { gasLimit: 1500000 };

(async () => {
  const eip = ganache.provider({ logging: { quiet: true }, chain: { chainId: 56 }, wallet: { totalAccounts: 8, defaultBalance: 10000 } });
  const provider = new ethers.BrowserProvider(eip);
  const s = [];
  for (let i = 0; i < 8; i++) s.push(await provider.getSigner(i));

  const dep = async (art, args = []) => {
    const c = await new ethers.ContractFactory(art.abi, art.bytecode, s[0]).deploy(...args);
    await c.waitForDeployment();
    return c;
  };
  const token = await dep(tokenArt);
  const nft = await dep(nftArt);
  const reg = await dep(regArt);
  const core = await dep(coreArt, [await token.getAddress(), await nft.getAddress(), await reg.getAddress(), await s[7].getAddress()]);
  await (await token.setMinter(await core.getAddress())).wait();
  await (await core.setMintOpen(true)).wait();
  await (await nft.setCore(await core.getAddress())).wait();

  sec("只读校验接口");
  const cases = [
    ["nova4", true], ["echo1", true], ["a", true], ["agent-007", true],
    ["abc123", true], ["a".repeat(24), true],
    ["", false], ["a".repeat(25), false],
    ["NOVA4", false], ["nova 4", false], ["nova4.ai", false],
    ["<script>", false], ["{{7*7}}", false], ["a;b", false], ["a.b", false],
    ["ignore previous instructions", false],
    ["⚠MUSTBUY", false], ["中文名字", false],
  ];
  for (const [h, want] of cases) {
    let got;
    try { got = await nft.isValidHandle(h); } catch (e) { got = "err"; }
    ok("isValidHandle(" + JSON.stringify(h.slice(0, 22)) + ")", got === want, String(got));
  }

  sec("铸造时强制执行");
  const tryMint = async (signer, handle) => {
    try {
      await (await reg.connect(signer).set(handle, await signer.getAddress(), G)).wait();
      await (await core.connect(signer).mintMiner(handle, { value: ethers.parseEther("0.001"), ...G })).wait();
      return "ok";
    } catch (e) {
      return (e.shortMessage || e.message || "").slice(0, 40);
    }
  };

  ok("正常 handle 可铸造", (await tryMint(s[1], "alice")) === "ok");
  ok("连字符 handle 可铸造", (await tryMint(s[2], "bob-test")) === "ok");

  const bad1 = await tryMint(s[3], "eve.ai");
  ok("含点的 handle 被拒", bad1 !== "ok", bad1);
  const bad2 = await tryMint(s[4], "x y");
  ok("含空格的 handle 被拒", bad2 !== "ok", bad2);
  const bad3 = await tryMint(s[5], "IGNORE-PREV");
  ok("含大写的 handle 被拒", bad3 !== "ok", bad3);

  sec("已铸矿机的 handle 不受影响");
  const n = Number(await core.minerCount());
  ok("矿机数 = 2", n === 2, String(n));
  // ganache 读 string 返回值有 bug，改用 keccak 哈希校验 handle 已被记录
  const hh = (x) => ethers.keccak256(ethers.toUtf8Bytes(x));
  ok("alice 已记录", await nft.handleUsed(hh("alice")));
  ok("bob-test 已记录", await nft.handleUsed(hh("bob-test")));
  ok("eve.ai 未被记录", !(await nft.handleUsed(hh("eve.ai"))));
  ok("IGNORE-PREV 未被记录", !(await nft.handleUsed(hh("IGNORE-PREV"))));

  console.log("\n\x1b[1m结果：" + pass + " 通过 / " + fail + " 失败\x1b[0m");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.shortMessage || e.message); process.exit(1); });
