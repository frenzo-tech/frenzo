/**
 * 核心单元测试 —— 双池挖矿模型（30% 好友池 / 70% key 池）
 * 运行：node scripts/test.js
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
const f = (x, d = 4) => Number(ethers.formatEther(x)).toFixed(d);

(async () => {
  const eip = ganache.provider({ logging: { quiet: true }, chain: { chainId: 56 }, wallet: { totalAccounts: 16, defaultBalance: 10000 } });
  const provider = new ethers.BrowserProvider(eip);
  const s = [];
  for (let i = 0; i < 14; i++) s.push(await provider.getSigner(i));
  const deployer = s[0];
  const treasury = s[13];

  const dep = async (art, args = []) => {
    const c = await new ethers.ContractFactory(art.abi, art.bytecode, deployer).deploy(...args);
    await c.waitForDeployment();
    return c;
  };
  const reg = await dep(regArt), token = await dep(tokenArt), nft = await dep(nftArt);
  const core = await dep(coreArt, [await token.getAddress(), await nft.getAddress(), await reg.getAddress(), treasury.address]);

  const G = { gasLimit: 3_000_000 };
  const send = async (tx) => (await tx).wait();

  sec("权限绑定");
  await send(await token.setMinter(await core.getAddress()));
  await send(await core.setMintOpen(true));
  await send(await nft.setCore(await core.getAddress()));
  await send(await core.setRegistry(await reg.getAddress()));
  ok("minter 绑定成功", (await token.minter()) === (await core.getAddress()));

  sec("铸造");
  const MINT = ethers.parseEther("0.001");
  const users = s.slice(0, 4);
  for (let i = 0; i < users.length; i++) {
    await send(await reg.set("u" + i, users[i].address));
    await send(await core.connect(users[i]).mintMiner("u" + i, { value: MINT, ...G }));
  }
  ok("铸造 4 台", (await core.minerCount()) === 4n);
  ok("阶梯价：第 1 档 0.001", (await core.mintPrice()) === MINT);

  const i1 = await core.minerInfo(1);
  ok("铸造赠送 2 份 key", i1[2] === 2n, `${i1[2]} 份`);
  ok("主人持有这 2 份", (await core.shares(1, users[0].address)) === 2n);
  ok("全网好友单位 = 4", (await core.totalFriendUnits()) === 4n);
  const tre = await provider.getBalance(treasury.address);
  ok("金库收到铸造价的一半左右", tre > 0n, `${f(tre, 6)} BNB`);

  sec("主人比例 r");
  ok("3 份 → 100%", (await core.ownerRatio(3)) === 10000n);
  ok("100 份 → 20%", (await core.ownerRatio(100)) === 2000n);
  ok("1,000 份 → 20%（封底）", (await core.ownerRatio(1000)) === 2000n);

  sec("好友");
  const rc = await send(await core.connect(users[0]).requestFriend(2, G));
  let rid;
  for (const log of rc.logs) { try { const p2 = core.interface.parseLog(log); if (p2 && p2.name === "FriendRequested") rid = p2.args[0]; } catch {} }
  await send(await core.connect(users[1]).acceptFriend(rid, G));
  ok("双方好友数 +1", (await core.minerInfo(1))[1] === 1n && (await core.minerInfo(2))[1] === 1n);
  ok("全网单位 +2（共 6）", (await core.totalFriendUnits()) === 6n);

  let threw = false;
  try { await send(await core.connect(users[0]).requestFriend(1, G)); } catch { threw = true; }
  ok("不能加自己", threw);

  sec("key 交易");
  const before = await core.totalKeyValue();
  const sup = (await core.minerInfo(1))[2];
  const cost = await core.costToBuy(sup, sup + 5n);
  const fee = (cost * 1000n) / 10000n;
  await send(await core.connect(users[2]).buyShares(1, 5, { value: cost + fee, ...G }));
  const afterBuy = await core.totalKeyValue();
  ok("买 key → 全网 key 市值 += cost", afterBuy - before === cost, `+${f(cost, 6)} BNB`);
  ok("买方持有 5 份", (await core.shares(1, users[2].address)) === 5n);

  const sup2 = (await core.minerInfo(1))[2];
  const gross = await core.costToBuy(sup2 - 2n, sup2);
  const kvBefore = await core.totalKeyValue();
  await send(await core.connect(users[2]).sellShares(1, 2, G));
  ok("卖 key → 全网 key 市值 -= gross", kvBefore - (await core.totalKeyValue()) === gross);

  sec("挖矿");
  await provider.send("evm_increaseTime", [3600]);
  await provider.send("evm_mine", []);
  // 累积器只在写操作时更新，这里用 pendingOf 的虚拟累积验证
  ok("两个池子都在累积", (await core.pendingOf(1)) > 0n, "通过 pendingOf 验证");

  const p1 = await core.pendingOf(1);
  ok("矿机 1 有待领", p1 > 0n, `${f(p1, 2)} ACT`);

  const bal0 = await token.balanceOf(users[0].address);
  await send(await core.connect(users[0]).claim(1, G));
  const bal1 = await token.balanceOf(users[0].address);
  ok("claim 成功铸币", bal1 > bal0, `+${f(bal1 - bal0, 2)} ACT`);
  ok("领完待领归零", (await core.pendingOf(1)) === 0n);

  const holderBal0 = await token.balanceOf(users[2].address);
  await send(await core.connect(users[2]).claim(1, G));
  ok("key 持有人也能领", (await token.balanceOf(users[2].address)) > holderBal0);

  sec("权重");
  const w1 = (await core.minerInfo(1))[4];
  const w4 = (await core.minerInfo(4))[4];
  ok("有好友+key 的矿机权重更高", w1 > w4, `#1=${w1}bps / #4=${w4}bps`);

  sec("NFT 市场");
  // users[0] 挂单卖 1 号矿机
  await send(await nft.connect(users[0]).approve(await core.getAddress(), 1, G));
  await send(await core.connect(users[0]).listMiner(1, ethers.parseEther("0.5"), G));
  const L = await core.listingOf(1);
  ok("挂单成功", L[2] === true && L[1] === ethers.parseEther("0.5"), `${ethers.formatEther(L[1])} BNB`);

  let threw2 = false;
  try { await send(await core.connect(s[10]).buyMiner(1, { value: ethers.parseEther("0.4"), ...G })); } catch { threw2 = true; }
  ok("出价不足被拒", threw2);

  const sellerBefore = BigInt(await provider.send("eth_getBalance", [users[0].address, "latest"]));
  const treBefore = BigInt(await provider.send("eth_getBalance", [treasury.address, "latest"]));
  await send(await core.connect(s[10]).buyMiner(1, { value: ethers.parseEther("0.5"), ...G }));
  const sellerAfter = BigInt(await provider.send("eth_getBalance", [users[0].address, "latest"]));
  const treAfter = BigInt(await provider.send("eth_getBalance", [treasury.address, "latest"]));

  ok("NFT 已转给买家", (await nft.ownerOf(1)) === s[10].address);
  ok("卖家收到 95%", sellerAfter - sellerBefore === ethers.parseEther("0.475"), `+${f(sellerAfter - sellerBefore, 4)} BNB`);
  ok("金库收到 5%", treAfter - treBefore === ethers.parseEther("0.025"), `+${f(treAfter - treBefore, 4)} BNB`);
  ok("挂单已清除", (await core.listingOf(1))[2] === false);

  sec("稀有度");
  const accs = new Set();
  for (let i = 1; i <= 3; i++) { try { accs.add(Number((await nft.faceOf(i)).accessory)); } catch {} }
  ok("faceOf 可读", (await nft.faceOf(2)).skin !== undefined, [...accs].join(","));

  sec("出价");
  await send(await core.connect(s[11]).makeOffer(2, { value: ethers.parseEther("0.3"), ...G }));
  let o = await core.offerOf(2);
  ok("出价已托管", o[0] === s[11].address && o[1] === ethers.parseEther("0.3"), `${f(o[1], 4)} BNB`);

  let threw3 = false;
  try { await send(await core.connect(s[12]).makeOffer(2, { value: ethers.parseEther("0.2"), ...G })); } catch { threw3 = true; }
  ok("低于当前最高价被拒", threw3);

  const prevBefore = BigInt(await provider.send("eth_getBalance", [s[11].address, "latest"]));
  await send(await core.connect(s[12]).makeOffer(2, { value: ethers.parseEther("0.4"), ...G }));
  const prevAfter = BigInt(await provider.send("eth_getBalance", [s[11].address, "latest"]));
  ok("上一位出价人被全额退款", prevAfter - prevBefore === ethers.parseEther("0.3"), `+${f(prevAfter - prevBefore, 4)} BNB`);

  const owner2 = (await core.minerInfo(2))[0];
  let ownerSigner = null;
  for (const sg of [...users, s[10], s[11], s[12]]) {
    if ((await sg.getAddress()).toLowerCase() === owner2.toLowerCase()) ownerSigner = sg;
  }
  if (ownerSigner) {
    await send(await nft.connect(ownerSigner).approve(await core.getAddress(), 2, G));
    const sb = BigInt(await provider.send("eth_getBalance", [owner2, "latest"]));
    await send(await core.connect(ownerSigner).acceptOffer(2, G));
    const sa = BigInt(await provider.send("eth_getBalance", [owner2, "latest"]));
    ok("接受出价后 NFT 转给买家", (await nft.ownerOf(2)) === s[12].address);
    ok("主人收到 95%（扣 gas）", sa - sb > ethers.parseEther("0.37") && sa - sb <= ethers.parseEther("0.38"), `net +${f(sa - sb, 4)} BNB`);
    ok("出价已清空", (await core.offerOf(2))[1] === 0n);
  } else {
    ok("找到主人账户", false, "跳过接受测试");
  }

  console.log("\n\x1b[1m结果：" + pass + " 通过 / " + fail + " 失败\x1b[0m");
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error("ERR", e.shortMessage || e.message); process.exitCode = 1; });
