/**
 * 托管资金闭环审查：totalEscrow 在所有路径上都守恒
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
  const eip = ganache.provider({ logging: { quiet: true }, chain: { chainId: 56 }, wallet: { totalAccounts: 10, defaultBalance: 10000 } });
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

  for (let i = 0; i < 3; i++) {
    await (await reg.connect(s[i + 1]).set("m" + i, await s[i + 1].getAddress(), G)).wait();
    await (await core.connect(s[i + 1]).mintMiner("m" + i, { value: ethers.parseEther("0.001"), ...G })).wait();
  }

  const esc = () => core.totalEscrow();

  sec("路径 1：出价 → 取消 → 托管归零");
  await (await core.connect(s[5]).makeOffer(1, { value: ethers.parseEther("0.2"), ...G })).wait();
  ok("出价后托管 0.2", (await esc()) === ethers.parseEther("0.2"));
  await (await core.connect(s[5]).cancelOffer(1, G)).wait();
  ok("取消后托管归零", (await esc()) === 0n);

  sec("路径 2：出价 → 被更高价顶掉 → 托管只保留最新");
  await (await core.connect(s[5]).makeOffer(1, { value: ethers.parseEther("0.2"), ...G })).wait();
  await (await core.connect(s[6]).makeOffer(1, { value: ethers.parseEther("0.3"), ...G })).wait();
  ok("托管 = 0.3（只记最新出价）", (await esc()) === ethers.parseEther("0.3"),
     ethers.formatEther(await esc()));

  sec("路径 3：出价 → 矿机易主 → 转为待提现 → 用户提走");
  await (await nft.connect(s[1]).approve(await core.getAddress(), 1)).wait();
  await (await core.connect(s[1]).listMiner(1, ethers.parseEther("0.01"), G)).wait();
  await (await core.connect(s[7]).buyMiner(1, { value: ethers.parseEther("0.01"), ...G })).wait();
  ok("易主后托管不变（转为欠款）", (await esc()) === ethers.parseEther("0.3"),
     ethers.formatEther(await esc()));
  ok("出价人可提现", (await core.refundCredit(await s[6].getAddress())) === ethers.parseEther("0.3"));

  await (await core.connect(s[6]).withdrawRefund(G)).wait();
  ok("提现后托管归零", (await esc()) === 0n);

  sec("路径 4：出价 → 被接受 → 托管冲抵成交价");
  await (await nft.connect(s[7]).approve(await core.getAddress(), 1)).wait();
  await (await core.connect(s[8]).makeOffer(1, { value: ethers.parseEther("0.05"), ...G })).wait();
  ok("出价后托管 0.05", (await esc()) === ethers.parseEther("0.05"));
  await (await core.connect(s[7]).acceptOffer(1, G)).wait();
  ok("接受后托管归零", (await esc()) === 0n);

  sec("不变量：托管 ≤ 合约余额");
  const bal = await provider.getBalance(await core.getAddress());
  ok("合约余额 ≥ 托管 + key 市值", bal >= (await esc()) + (await core.totalKeyValue()),
     "余额 " + ethers.formatEther(bal));

  sec("空池兜底：spareBnb 恒为 0");
  ok("spareBnb = 0", (await core.spareBnb()) === 0n);

  console.log("\n\x1b[1m结果：" + pass + " 通过 / " + fail + " 失败\x1b[0m");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.shortMessage || e.message); process.exit(1); });
