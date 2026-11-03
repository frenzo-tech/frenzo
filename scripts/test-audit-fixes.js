/**
 * 审计修复回归测试
 *   H-01 acceptFriend 幂等
 *   C-02 托管不计入 spareBnb
 *   H-02 多签轮换后按实时票数
 *   H-03 手续费改 pull
 */
const { ethers } = require("ethers");
const ganache = require("ganache");
const coreArt = require("../artifacts/CityCore.json");
const tokenArt = require("../artifacts/AgentToken.json");
const nftArt = require("../artifacts/MinerNFT.json");
const regArt = require("../artifacts/MockRegistry.json");
const msArt = require("../artifacts/FrenzoMultiSig.json");

let pass = 0, fail = 0;
const ok = (n, c, e = "") => {
  if (c) { pass++; console.log("  \x1b[32m✓\x1b[0m " + n + (e ? "  \x1b[90m" + e + "\x1b[0m" : "")); }
  else { fail++; console.log("  \x1b[31m✗\x1b[0m " + n + (e ? "  \x1b[90m" + e + "\x1b[0m" : "")); }
};
const sec = (t) => console.log("\n\x1b[36m━━ " + t + " ━━\x1b[0m");
const G = { gasLimit: 1500000 };

(async () => {
  const eip = ganache.provider({ logging: { quiet: true }, chain: { chainId: 56 }, wallet: { totalAccounts: 12, defaultBalance: 10000 } });
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
  const reg = await dep(regArt);
  const core = await dep(coreArt, [await token.getAddress(), await nft.getAddress(), await reg.getAddress(), await s[9].getAddress()]);

  await (await token.setMinter(await core.getAddress())).wait();
  await (await core.setMintOpen(true)).wait();
  await (await nft.setCore(await core.getAddress())).wait();

  // 铸 3 台
  for (let i = 0; i < 3; i++) {
    await (await reg.connect(s[i + 1]).set("a" + i, await s[i + 1].getAddress())).wait();
    await (await core.connect(s[i + 1]).mintMiner("a" + i, { value: ethers.parseEther("0.001"), ...G })).wait();
  }

  // ══════════ H-01 ══════════
  sec("H-01 acceptFriend 幂等");
  const r1 = await (await core.connect(s[1]).requestFriend(2, G)).wait();
  const r2 = await (await core.connect(s[1]).requestFriend(2, G)).wait();
  const getReq = (rc) => {
    for (const lg of rc.logs) {
      try { const pl = core.interface.parseLog(lg); if (pl && pl.name === "FriendRequested") return pl.args[0]; } catch {}
    }
  };
  const id1 = getReq(r1), id2 = getReq(r2);
  ok("可以发多条 pending 请求", id1 !== undefined && id2 !== undefined, "req " + id1 + ", " + id2);

  await (await core.connect(s[2]).acceptFriend(id1, G)).wait();
  const units1 = await core.totalFriendUnits();
  ok("第一次接受成功", true, "units " + units1);

  let blocked = false;
  try { await (await core.connect(s[2]).acceptFriend(id2, G)).wait(); } catch { blocked = true; }
  const units2 = await core.totalFriendUnits();
  ok("第二条重复接受被拒", blocked);
  ok("好友单位没有再增加", units2 === units1, units1 + " → " + units2);

  // ══════════ C-02 ══════════
  sec("C-02 出价托管不计入 spareBnb");
  const before = await core.spareBnb();
  ok("初始 spareBnb 为 0", before === 0n, before.toString());

  const offer = ethers.parseEther("0.5");
  await (await core.connect(s[5]).makeOffer(1, { value: offer, ...G })).wait();
  const escrow = await core.totalEscrow();
  const spareAfter = await core.spareBnb();
  ok("托管已记账", escrow === offer, ethers.formatEther(escrow) + " BNB");
  ok("spareBnb 仍为 0（不会被回购吃掉）", spareAfter === 0n, spareAfter.toString());

  let tooMuch = false;
  try { await (await core.connect(s[5]).buybackAndBurn(offer, 0, G)).wait(); } catch { tooMuch = true; }
  ok("拿托管金额调用 buybackAndBurn 被拒", tooMuch);

  await (await core.connect(s[5]).cancelOffer(1, G)).wait();
  ok("取消出价后退款成功", (await core.totalEscrow()) === 0n);

  // ══════════ H-03 ══════════
  sec("H-03 手续费走 pull（记账）");
  const cost = await core.costToBuy(2, 3);
  const fee = (cost * 1000n) / 10000n;
  const owner1 = await nft.ownerOf(1);
  const beforeCredit = await core.creatorCredit(owner1);
  await (await core.connect(s[4]).buyShares(1, 1, { value: cost + fee + 1n, ...G })).wait();
  const afterCredit = await core.creatorCredit(owner1);
  ok("矿机主人记账增加", afterCredit > beforeCredit, ethers.formatEther(afterCredit - beforeCredit) + " BNB");

  // 金额只有 0.0000125 BNB，比 gas 还小，所以用「记账归零」验证而不是余额
  await (await core.connect(s[1]).withdrawCreatorCredit(G)).wait();
  ok("主人提现后记账归零", (await core.creatorCredit(owner1)) === 0n);
  let nothing = false;
  try { await (await core.connect(s[1]).withdrawCreatorCredit(G)).wait(); } catch { nothing = true; }
  ok("无余额时提现被拒", nothing);

  // ══════════ H-02 ══════════
  sec("H-02 多签轮换后按实时票数");
  const o1 = await s[6].getAddress(), o2 = await s[7].getAddress(), o3 = await s[8].getAddress();
  const ms = await dep(msArt, [[o1, o2, o3], 2]);
  const msAddr = await ms.getAddress();
  await (await s[5].sendTransaction({ to: msAddr, value: ethers.parseEther("3") })).wait();

  const lc0 = await ms.liveConfirmations(0);
  await (await ms.connect(s[6]).submit(await s[9].getAddress(), ethers.parseEther("1"), "0x", G)).wait();
  ok("提交后 1 票", (await ms.liveConfirmations(0)) === 1n);

  let cannotExec = false;
  try { await (await ms.connect(s[5]).execute(0, G)).wait(); } catch { cannotExec = true; }
  ok("1 票不能执行", cannotExec);

  // 轮换掉提交人
  const data = ms.interface.encodeFunctionData("replaceOwner", [o1, await s[9].getAddress()]);
  await (await ms.connect(s[7]).submit(msAddr, 0, data, G)).wait();
  await (await ms.connect(s[8]).confirm(1, G)).wait();
  await (await ms.connect(s[5]).execute(1, G)).wait();
  ok("轮换成功", (await ms.isOwner(o1)) === false);

  ok("轮换后原提案票数归零", (await ms.liveConfirmations(0)) === 0n,
     "live=" + (await ms.liveConfirmations(0)));
  let stillBlocked = false;
  try { await (await ms.connect(s[5]).execute(0, G)).wait(); } catch { stillBlocked = true; }
  ok("轮换后不能靠残留票执行", stillBlocked);

  console.log("\n\x1b[1m结果：" + pass + " 通过 / " + fail + " 失败\x1b[0m");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.shortMessage || e.message); process.exit(1); });
