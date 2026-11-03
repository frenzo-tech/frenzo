const { ethers } = require("ethers");
const ganache = require("ganache");

const coreArt = require("../artifacts/CityCore.json");
const tokenArt = require("../artifacts/AgentToken.json");
const nftArt = require("../artifacts/MinerNFT.json");
const regArt = require("../artifacts/MockRegistry.json");

let pass = 0, fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log("\x1b[32m  ✓\x1b[0m " + name + (extra ? "  \x1b[90m" + extra + "\x1b[0m" : "")); }
  else { fail++; console.log("\x1b[31m  ✗\x1b[0m " + name + (extra ? "  \x1b[90m" + extra + "\x1b[0m" : "")); }
}
const f = (x, d = 4) => Number(ethers.formatEther(x)).toFixed(d);

(async () => {
  const eip = ganache.provider({ logging: { quiet: true }, chain: { chainId: 56 }, wallet: { totalAccounts: 20, defaultBalance: 10000 } });
  const provider = new ethers.BrowserProvider(eip);
  const signers = [];
  for (let i = 0; i < 12; i++) signers.push(await provider.getSigner(i));
  const deployer = signers[0], treasury = signers[11];

  const dep = async (art, args = []) => {
    const c = await new ethers.ContractFactory(art.abi, art.bytecode, deployer).deploy(...args);
    await c.waitForDeployment();
    return c;
  };
  const reg = await dep(regArt), token = await dep(tokenArt), nft = await dep(nftArt);
  const core = await dep(coreArt, [await token.getAddress(), await nft.getAddress(), await reg.getAddress(), treasury.address]);
  await (await token.setMinter(await core.getAddress())).wait();
  await (await core.setMintOpen(true)).wait();
  await (await nft.setCore(await core.getAddress())).wait();
  await (await core.setRegistry(await reg.getAddress())).wait();

  const MINT = ethers.parseEther("0.001");
  const users = signers.slice(0, 10);

  console.log("\n━━ 铸造 ━━");
  for (let i = 0; i < users.length; i++) {
    await (await reg.set("u" + i, users[i].address)).wait();
    await (await core.connect(users[i]).mintMiner("u" + i, { value: MINT, gasLimit: 3000000 })).wait();
  }
  ok("铸造 10 台", (await core.minerCount()) === 10n);
  ok("全网好友单位 = 10（每台自带 1）", (await core.totalFriendUnits()) === 10n, `${await core.totalFriendUnits()}`);
  const kv0 = await core.totalKeyValue();
  ok("全网 key 市值 = 10 台赠送份额成本", kv0 > 0n, `${f(kv0, 6)} BNB`);

  console.log("\n━━ 主人比例 r（按份数）──");
  ok("3 份 → 100%", (await core.ownerRatio(3)) === 10000n);
  ok("10 份 → 94.2%", Math.abs(Number(await core.ownerRatio(10)) - 9423) <= 2, `${Number(await core.ownerRatio(10)) / 100}%`);
  ok("50 份 → 61.2%", Math.abs(Number(await core.ownerRatio(50)) - 6124) <= 2, `${Number(await core.ownerRatio(50)) / 100}%`);
  ok("100 份 → 20%（打满）", (await core.ownerRatio(100)) === 2000n);
  ok("1000 份 → 20%（封底）", (await core.ownerRatio(1000)) === 2000n);

  console.log("\n━━ 好友池 30% 按单位分 ━━");
  const addFriend = async (a, b) => {
    const rc = await (await core.connect(users[a]).requestFriend(b + 1, { gasLimit: 3000000 })).wait();
    let rid;
    for (const log of rc.logs) {
      try { const p = core.interface.parseLog(log); if (p && p.name === "FriendRequested") rid = p.args[0]; } catch {}
    }
    await (await core.connect(users[b]).acceptFriend(rid, { gasLimit: 3000000 })).wait();
  };

  await addFriend(0, 1);   // a-b
  ok("加 1 对好友 → 单位 +2", (await core.totalFriendUnits()) === 12n, `${await core.totalFriendUnits()}`);
  await addFriend(1, 2);   // b-c
  await addFriend(0, 3);   // a-d
  ok("再 2 对 → 单位 16", (await core.totalFriendUnits()) === 16n);

  // a 的好友 = 2, b = 2, c = 1, d = 1 → 单位：3,3,2,2
  ok("a 好友数 = 2", (await core.minerInfo(1))[1] === 2n, `${(await core.minerInfo(1))[1]}`);

  console.log("\n━━ 挖矿 1 小时 ━━");
  await provider.send("evm_increaseTime", [3600]);
  await provider.send("evm_mine", []);
  const totalMined0 = await core.totalMined();
  ok("a 1 小时应分约 480 枚", Math.abs(Number(f(await core.pendingOf(1), 2)) - 480) < 12, `${f(await core.pendingOf(1), 2)} ACT`);

  const af = await core.accFriendPerUnit(), ak = await core.accKeyPerValue();
  ok("好友池累积器 > 0", af > 0n, `${f(af, 8)}`);
  ok("key 池累积器 > 0", ak > 0n, `${f(ak, 8)}`);

  console.log("\n━━ 领取与分配 ━━");
  const pend1 = await core.pendingOf(1);
  ok("a 有待领收益", pend1 > 0n, `${f(pend1, 2)} ACT`);

  const before = await token.balanceOf(users[0].address);
  await (await core.connect(users[0]).claim(1, { gasLimit: 3000000 })).wait();
  const after = await token.balanceOf(users[0].address);
  ok("领取成功", after > before, `+${f(after - before, 2)} ACT`);
  ok("领完待领归零", (await core.pendingOf(1)) === 0n);

  console.log("\n━━ 权重展示 ━━━");
  const w1 = (await core.minerInfo(1))[4];
  const w9 = (await core.minerInfo(9))[4];
  ok("a 权重 > 无好友矿机", w1 > w9, `a=${w1}bps / #9=${w9}bps`);

  console.log("\n\x1b[1m结果：" + pass + " 通过 / " + fail + " 失败\x1b[0m");
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error("ERR", e.shortMessage || e.message); process.exitCode = 1; });
