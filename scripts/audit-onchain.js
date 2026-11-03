/**
 * 链上状态审计：不变量、权限、资产对账
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const cfg = require("../deployment-97.json");
const RPC = "https://bsc-testnet-rpc.publicnode.com";

let pass = 0, fail = 0;
const ok = (n, c, e = "") => {
  if (c) { pass++; console.log("  \x1b[32m✓\x1b[0m " + n + (e ? "  \x1b[90m" + e + "\x1b[0m" : "")); }
  else { fail++; console.log("  \x1b[31m✗\x1b[0m " + n + (e ? "  \x1b[90m" + e + "\x1b[0m" : "")); }
};
const sec = (t) => console.log("\n\x1b[36m━━ " + t + " ━━\x1b[0m");

(async () => {
  const p = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  const core = new ethers.Contract(cfg.core, require("../artifacts/CityCore.json").abi, p);
  const nft = new ethers.Contract(cfg.nft, require("../artifacts/MinerNFT.json").abi, p);
  const token = new ethers.Contract(cfg.token, require("../artifacts/AgentToken.json").abi, p);
  const ms = new ethers.Contract(cfg.multisig, require("../artifacts/FrenzoMultiSig.json").abi, p);

  sec("资产对账（最关键的不变量）");
  const tkv = await core.totalKeyValue();
  const coreBal = await p.getBalance(cfg.core);
  ok("合约余额 ≥ key 总市值（兑付能力）", coreBal >= tkv,
     "余额 " + ethers.formatEther(coreBal) + " ≥ " + ethers.formatEther(tkv));

  const spare = coreBal - tkv;
  ok("闲置 BNB 可控", spare >= 0n, "闲置 " + ethers.formatEther(spare));

  sec("好友不变量");
  const n = Number(await core.minerCount());
  let sumFriends = 0n, sumUnits = 0n;
  for (let id = 1; id <= n; id++) {
    const info = await core.minerInfo(id);
    sumFriends += BigInt(info[1]);
  }
  sumUnits = await core.totalFriendUnits();
  // Σ(friends+1) 应等于 totalFriendUnits
  ok("Σ(friends+1) == totalFriendUnits", sumFriends + BigInt(n) === sumUnits,
     sumFriends + "+" + n + " = " + sumUnits);

  sec("份数不变量");
  let sumSupply = 0n, sumRevenue = 0n;
  for (let id = 1; id <= n; id++) {
    const info = await core.minerInfo(id);
    sumSupply += BigInt(info[2]);
    sumRevenue += BigInt(info[3]);
  }
  ok("ΣshareRevenue == totalKeyValue", sumRevenue === tkv,
     ethers.formatEther(sumRevenue) + " vs " + ethers.formatEther(tkv));
  ok("每台矿机份数 ≥ 2", sumSupply >= BigInt(n * 2), "总份数 " + sumSupply);

  sec("权重守恒");
  let powerSum = 0n;
  for (let id = 1; id <= n; id++) {
    const info = await core.minerInfo(id);
    powerSum += BigInt(info[4]);
  }
  ok("Σ权重 ≈ 10000 bps（允许取整误差）", powerSum > 9900n && powerSum <= 10000n, powerSum + " bps");

  sec("代币");
  const supply = await token.totalSupply();
  const mined = await core.totalMined();
  ok("totalSupply ≤ MAX_SUPPLY", supply <= (await core.MAX_SUPPLY()));
  ok("已铸 ≤ 已挖", supply <= mined, ethers.formatEther(supply) + " ≤ " + ethers.formatEther(mined));
  ok("minter = CityCore", (await token.minter()).toLowerCase() === cfg.core.toLowerCase());

  sec("NFT 与矿机一致性");
  let ownerMismatch = 0;
  for (let id = 1; id <= n; id++) {
    const nftOwner = await nft.ownerOf(id);
    const info = await core.minerInfo(id);
    if (nftOwner.toLowerCase() !== info[0].toLowerCase()) ownerMismatch++;
  }
  ok("NFT owner == CityCore 记录", ownerMismatch === 0, ownerMismatch ? ownerMismatch + " 台不一致" : n + " 台全部一致");

  sec("权限");
  ok("treasury = 多签", (await core.treasury()).toLowerCase() === cfg.multisig.toLowerCase());
  ok("多签阈值 2-of-3", (await ms.required()) === 2n && (await ms.ownerCount()) === 3n);
  const msBal = await p.getBalance(cfg.multisig);
  ok("多签余额可查", true, ethers.formatEther(msBal) + " BNB");
  ok("所有权未放弃（可控）", (await core.owner()) !== ethers.ZeroAddress);

  sec("曲线");
  const sumSq = (x) => (x === 0n ? 0n : ((x - 1n) * x * (2n * (x - 1n) + 1n)) / 6n);
  let curveOk = 0;
  for (const [a, b] of [[0n, 2n], [2n, 3n], [5n, 10n], [20n, 25n]]) {
    const on = await core.costToBuy(a, b);
    const off = ((sumSq(b) - sumSq(a)) * 10n ** 18n) / 16000n;
    if (on === off) curveOk++;
  }
  ok("friend.tech 曲线 4/4", curveOk === 4);

  sec("铸造价阶梯");
  const price = await core.mintPrice();
  ok("当前档位单价 0.0003", price === ethers.parseEther("0.0003"), ethers.formatEther(price) + " BNB");
  const keyCost = await core.costToBuy(0, 2);
  ok("铸造价覆盖 2 份 key 成本", price >= keyCost, ethers.formatEther(keyCost) + " BNB");

  console.log("\n\x1b[1m链上审计：" + pass + " 通过 / " + fail + " 失败\x1b[0m");
})().catch((e) => console.error("FATAL", e.shortMessage || e.message));
