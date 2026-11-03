/**
 * 空窗期不累积：M-03 修复的补漏验证
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
const G = { gasLimit: 1500000 };

(async () => {
  const eip = ganache.provider({ logging: { quiet: true }, chain: { chainId: 56 }, wallet: { totalAccounts: 8, defaultBalance: 10000 } });
  const provider = new ethers.BrowserProvider(eip);
  const s = [];
  for (let i = 0; i < 6; i++) s.push(await provider.getSigner(i));

  const dep = async (art, args = []) => {
    const c = await new ethers.ContractFactory(art.abi, art.bytecode, s[0]).deploy(...args);
    await c.waitForDeployment();
    return c;
  };
  const token = await dep(tokenArt);
  const nft = await dep(nftArt);
  const reg = await dep(regArt);
  const core = await dep(coreArt, [await token.getAddress(), await nft.getAddress(), await reg.getAddress(), await s[5].getAddress()]);
  await (await token.setMinter(await core.getAddress())).wait();
  await (await core.setMintOpen(true)).wait();
  await (await nft.setCore(await core.getAddress())).wait();

  console.log("\x1b[36m━━ 空窗期不应累积产出 ━━\x1b[0m");

  const t0 = await core.totalMined();
  ok("初始 totalMined 为 0", t0 === 0n);

  // 空等 3 秒（两个池都空）
  await new Promise((r) => setTimeout(r, 3200));
  await (await core.accrue(G)).wait();
  const t1 = await core.totalMined();
  ok("空窗 accrue 后 totalMined 仍为 0", t1 === 0n, t1.toString());

  // 再等 3 秒，再 accrue —— 如果 lastUpdate 没推进，dt 会一直累加
  await new Promise((r) => setTimeout(r, 3200));
  await (await core.accrue(G)).wait();
  const t2 = await core.totalMined();
  ok("第二次空窗 accrue 仍为 0（没有累积）", t2 === 0n, t2.toString());

  // 现在铸一台矿机，池子不再为空
  await (await reg.connect(s[1]).set("alice", await s[1].getAddress(), G)).wait();
  await (await core.connect(s[1]).mintMiner("alice", { value: ethers.parseEther("0.001"), ...G })).wait();

  const pend = await core.pendingOf(1);
  ok("首个矿机的待领是正常量级（不是空窗期积压）", pend < ethers.parseEther("10"),
     "待领 " + ethers.formatEther(pend) + " FRNZ");

  // 正常运转 3 秒应该产生接近 3 × REWARD_PER_SEC 的量
  // 注意：ganache 的链上时间只在出块时推进，必须发一笔交易
  await new Promise((r) => setTimeout(r, 3200));
  await (await s[0].sendTransaction({ to: await s[2].getAddress(), value: 1n })).wait();
  const pend2 = await core.pendingOf(1);
  const rps = await core.REWARD_PER_SEC();
  const expect3s = rps * 3n;
  ok("正常产出量级正确", pend2 < expect3s * 3n && pend2 > 0n,
     "待领 " + ethers.formatEther(pend2) + " vs 3 秒理论 " + ethers.formatEther(expect3s));

  console.log("\n\x1b[1m结果：" + pass + " 通过 / " + fail + " 失败\x1b[0m");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.shortMessage || e.message); process.exit(1); });
