/**
 * 全流程集成测试 —— 双池模型（30% 好友池 / 70% key 池 / 主人 r 递减）
 * 运行：node scripts/test-full.js
 */
const { ethers } = require("ethers");
const ganache = require("ganache");

const coreArt = require("../artifacts/CityCore.json");
const tokenArt = require("../artifacts/AgentToken.json");
const nftArt = require("../artifacts/MinerNFT.json");
const regArt = require("../artifacts/MockRegistry.json");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("\x1b[32m  ✓\x1b[0m " + name + (extra ? "  \x1b[90m" + extra + "\x1b[0m" : "")); }
  else { fail++; console.log("\x1b[31m  ✗\x1b[0m " + name + (extra ? "  \x1b[90m" + extra + "\x1b[0m" : "")); }
};
const sec = (t) => console.log("\n\x1b[36m━━ " + t + " ━━\x1b[0m");
const f = (x, d = 2) => Number(ethers.formatEther(x)).toFixed(d);

const DAY = 86400;
const N = 20;

(async () => {
  const eip = ganache.provider({ logging: { quiet: true }, chain: { chainId: 56 }, wallet: { totalAccounts: N + 4, defaultBalance: 20000 } });
  const provider = new ethers.BrowserProvider(eip);
  const s = [];
  for (let i = 0; i < N + 4; i++) s.push(await provider.getSigner(i));
  const deployer = s[0], treasury = s[N + 3];

  const dep = async (art, args = []) => {
    const c = await new ethers.ContractFactory(art.abi, art.bytecode, deployer).deploy(...args);
    await c.waitForDeployment();
    return c;
  };
  const reg = await dep(regArt), token = await dep(tokenArt), nft = await dep(nftArt);
  const core = await dep(coreArt, [await token.getAddress(), await nft.getAddress(), await reg.getAddress(), treasury.address]);
  const G = { gasLimit: 3_000_000 };
  const send = async (tx) => (await tx).wait();

  await send(await token.setMinter(await core.getAddress()));
  await send(await core.setMintOpen(true));
  await send(await nft.setCore(await core.getAddress()));
  await send(await core.setRegistry(await reg.getAddress()));

  const MINT = ethers.parseEther("0.001");
  const users = s.slice(0, N);

  sec("Phase 1 · 铸造 20 台");
  for (let i = 0; i < N; i++) {
    await send(await reg.set("a" + i, users[i].address));
    await send(await core.connect(users[i]).mintMiner("a" + i, { value: MINT, ...G }));
  }
  ok("铸造 20 台", (await core.minerCount()) === BigInt(N));
  ok("全网好友单位 = 20", (await core.totalFriendUnits()) === 20n);
  const kv0 = await core.totalKeyValue();
  ok("全网 key 市值 > 0", kv0 > 0n, `${f(kv0, 6)} BNB`);

  sec("Phase 2 · 好友图");
  const reqId = async (tx) => {
    const rc = await send(tx);
    for (const log of rc.logs) { try { const p = core.interface.parseLog(log); if (p && p.name === "FriendRequested") return p.args[0]; } catch {} }
  };
  let pairs = 0;
  for (let i = 0; i < N; i++) {
    for (let k = 1; k <= 3; k++) {
      const j = (i + k) % N;
      if (i >= j) continue;
      const rid = await reqId(await core.connect(users[i]).requestFriend(j + 1, G));
      await send(await core.connect(users[j]).acceptFriend(rid, G));
      pairs++;
    }
  }
  const tf = await core.totalFriendUnits();
  ok("好友关系建立 " + pairs + " 对", pairs > 0);
  ok("全网单位 = 20 + 2×配对", tf === BigInt(20 + pairs * 2), `${tf}`);

  sec("Phase 3 · key 交易");
  const buy = async (who, id, n) => {
    const sup = (await core.minerInfo(id))[2];
    const cost = await core.costToBuy(sup, sup + BigInt(n));
    const fee = (cost * 1000n) / 10000n;
    await send(await core.connect(users[who]).buyShares(id, n, { value: cost + fee, ...G }));
    return cost;
  };
  for (let i = 0; i < 10; i++) await buy(i, ((i * 3) % N) + 1, 5 + i);
  ok("10 笔买入完成", true);

  const sup1 = (await core.minerInfo(1))[2];
  ok("矿机 1 份数增加", sup1 > 3n, `${sup1} 份`);
  const r1 = await core.ownerRatio(sup1);
  ok("r 随份数下降", r1 < 10000n, `r=${Number(r1) / 100}%`);

  sec("Phase 4 · 30 天模拟");
  await provider.send("evm_increaseTime", [DAY * 30]);
  await provider.send("evm_mine", []);

  let claimed = 0n;
  for (let i = 1; i <= N; i++) {
    const bal0 = await token.balanceOf(users[i - 1].address);
    await send(await core.connect(users[i - 1]).claim(i, G));
    claimed += (await token.balanceOf(users[i - 1].address)) - bal0;
  }
  const expect = ethers.parseEther("91324") * 30n;
  ok("30 天发放总量符合预期", claimed > (expect * 9n) / 10n && claimed <= (expect * 11n) / 10n,
     `${f(claimed, 0)} / 预期 ${f(expect, 0)}`);

  const tm = await core.totalMined();
  ok("totalMined ≤ 总量上限", tm <= ethers.parseEther("100000000"));

  sec("Phase 5 · 权重守恒");
  let sumW = 0n;
  for (let i = 1; i <= N; i++) sumW += (await core.minerInfo(i))[4];
  ok("Σ 权重 ≈ 10000 bps", sumW > 9900n && sumW <= 10100n, `${sumW} bps`);

  sec("Phase 6 · 主人与持有人分配");
  await provider.send("evm_increaseTime", [DAY]);
  await provider.send("evm_mine", []);
  const info = await core.minerInfo(1);
  const supNow = info[2];
  const rNow = await core.ownerRatio(supNow);
  const ownerPending = await core.pendingOf(1);
  ok("r 与份数一致", rNow === (supNow >= 100n ? 2000n : 10000n - (8000n * (supNow - 3n)) / 97n),
     `份数 ${supNow} → r ${Number(rNow) / 100}%`);

  let holderSum = 0n;
  for (let i = 0; i < N; i++) {
    const sh = await core.shares(1, users[i].address);
    if (sh === 0n) continue;
    const before = await token.balanceOf(users[i].address);
    await send(await core.connect(users[i]).claim(1, G));
    holderSum += (await token.balanceOf(users[i].address)) - before;
  }
  ok("主人与持有人都分到币", ownerPending > 0n && holderSum > 0n, `主人待领 ${f(ownerPending, 1)}`);

  sec("Phase 7 · 买卖往返损耗");
  const s0 = BigInt(await provider.send("eth_getBalance", [users[2].address, "latest"]));
  const supA = (await core.minerInfo(2))[2];
  const cA = await core.costToBuy(supA, supA + 100n);
  const fA = (cA * 1000n) / 10000n;
  await send(await core.connect(users[2]).buyShares(2, 100, { value: cA + fA, ...G }));
  const back = await core.costToBuy((await core.minerInfo(2))[2] - 100n, (await core.minerInfo(2))[2]);
  await send(await core.connect(users[2]).sellShares(2, 100, G));
  const s1 = BigInt(await provider.send("eth_getBalance", [users[2].address, "latest"]));
  ok("卖出拿回的比买入花的少", back < cA + fA, `买入 ${f(cA + fA, 6)} / 卖回 ${f(back, 6)} BNB`);
  ok("往返后余额下降", s1 < s0, `-${f(s0 - s1, 6)} BNB`);

  sec("Phase 8 · 权限");
  await send(await token.renounceOwnership());
  ok("代币权限已放弃", (await token.owner()) === ethers.ZeroAddress);

  let threw = false;
  try { await send(await core.connect(users[0]).mintMiner("a0", { value: MINT, ...G })); } catch { threw = true; }
  ok("同一地址不能再铸第二台", threw);

  console.log("\n\x1b[1m结果：" + pass + " 通过 / " + fail + " 失败\x1b[0m");
  console.log("\x1b[90m全网单位 " + (await core.totalFriendUnits()) + " · key 市值 " + f(await core.totalKeyValue(), 6) + " BNB · 已挖 " + f(await core.totalMined(), 0) + " ACT\x1b[0m");
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error("ERR", e.shortMessage || e.message); process.exitCode = 1; });
