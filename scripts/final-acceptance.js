/**
 * 最终验收：链上状态 + 站点 + 文档一致性
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { ethers } = require("ethers");
const cfg = require("../deployment-97.json");
const RPC = "https://bsc-testnet-rpc.publicnode.com";

let pass = 0, fail = 0;
const ok = (n, c, e = "") => {
  if (c) { pass++; console.log("  \x1b[32m✓\x1b[0m " + n + (e ? "  \x1b[90m" + e + "\x1b[0m" : "")); }
  else { fail++; console.log("  \x1b[31m✗\x1b[0m " + n + (e ? "  \x1b[90m" + e + "\x1b[0m" : "")); }
};
const sec = (t) => console.log("\n\x1b[36m━━ " + t + " ━━\x1b[0m");

function get(p) {
  return new Promise((r) => {
    https.get({ host: "45.153.130.144", servername: "frenzo.tech", path: p, headers: { Host: "frenzo.tech" }, rejectUnauthorized: false }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => r({ s: res.statusCode, body: b }));
    }).on("error", () => r({ s: 0, body: "" }));
  });
}

(async () => {
  const p = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  const core = new ethers.Contract(cfg.core, require("../artifacts/CityCore.json").abi, p);
  const nft = new ethers.Contract(cfg.nft, require("../artifacts/MinerNFT.json").abi, p);
  const token = new ethers.Contract(cfg.token, require("../artifacts/AgentToken.json").abi, p);
  const w = new ethers.Wallet(fs.readFileSync(path.join(__dirname, "..", ".testkey"), "utf8").trim(), p);

  sec("链上参数（应等于主网配置）");
  ok("铸造价 0.0003", (await core.mintPrice()) === ethers.parseEther("0.0003"));
  ok("初始份数 2", (await core.MINT_KEYS()) === 2n);
  ok("曲线常数 16000", (await core.CURVE_K()) === 16000n);
  ok("买卖费率 10%", (await core.FEE_BPS()) === 1000n);
  ok("矿主分成 50% of fee", (await core.CREATOR_FEE_BPS()) === 5000n);
  ok("好友费 1 FRNZ", (await core.FRIEND_COST()) === ethers.parseEther("1"));
  ok("免费好友 10", (await core.FRIEND_FREE()) === 10n);
  ok("NFT 市场费 5%", (await core.MARKET_FEE_BPS()) === 500n);
  ok("总量 1 亿", (await core.MAX_SUPPLY()) === ethers.parseEther("100000000"));

  sec("权限与国库");
  const treas = await core.treasury();
  ok("treasury = 多签", treas.toLowerCase() === cfg.multisig.toLowerCase(), treas.slice(0, 12) + "…");
  ok("CityCore 所有权保留", (await core.owner()).toLowerCase() === w.address.toLowerCase());
  ok("AgentToken 所有权保留", (await token.owner()).toLowerCase() === w.address.toLowerCase());
  ok("minter 已绑定", (await token.minter()).toLowerCase() === cfg.core.toLowerCase());

  sec("社交数据");
  const n = Number(await core.minerCount());
  ok("矿机 12 台", n === 12, n + " 台");
  ok("好友单位 > 0", Number(await core.totalFriendUnits()) > 0, (await core.totalFriendUnits()).toString());
  ok("群组 2 个", Number(await core.groupCount()) === 2);
  const hs = await nft.handlesBatch(1, 12);
  ok("handlesBatch 返回 12 个", hs.length === 12, hs.slice(0, 4).join(", "));

  sec("曲线与链上一致");
  const sumSq = (x) => (x === 0n ? 0n : ((x - 1n) * x * (2n * (x - 1n) + 1n)) / 6n);
  let curveOk = 0;
  for (const [a, b] of [[0n, 2n], [2n, 3n], [10n, 15n]]) {
    const onchain = await core.costToBuy(a, b);
    const offchain = ((sumSq(b) - sumSq(a)) * 10n ** 18n) / 16000n;
    if (onchain === offchain) curveOk++;
  }
  ok("friend.tech 曲线 3/3", curveOk === 3);

  sec("站点");
  const home = await get("/");
  ok("首页 200", home.s === 200);
  const chain = await get("/nft/chain.json");
  let cj = {};
  try { cj = JSON.parse(chain.body); } catch (e) {}
  ok("chain.json 指向新合约", cj.nft && cj.nft.toLowerCase() === cfg.nft.toLowerCase(), cj.nft || "-");
  const cfgRes = await get("/deployment-local.json");
  let cj2 = {};
  try { cj2 = JSON.parse(cfgRes.body); } catch (e) {}
  ok("站点配置指向新合约", cj2.core && cj2.core.toLowerCase() === cfg.core.toLowerCase());
  ok("站点配置无私钥", !cfgRes.body.includes("privateKey"));
  ok("agent-tools.json 可访问", (await get("/agent-tools.json")).s === 200);

  sec("文档一致性");
  const docsStart = home.body.indexOf('<section class="docs" id="docs">');
  const docsEnd = home.body.indexOf("</section>", home.body.indexOf('<article class="d-art" id="d-faq"'));
  const docs = home.body.slice(docsStart, docsEnd);
  ok("铸造价 0.0003", docs.includes("0.0003 BNB"));
  ok("费率 10%", docs.includes("买卖各 10%"));
  ok("5% 给矿机主人", docs.includes("5% 给矿机主人"));
  ok("好友费 1 FRNZ", docs.includes("1 FRNZ") && !docs.includes("0.1 FRNZ"));
  ok("初始 2 份", docs.includes("2 份 key") || docs.includes("获得 2 份"));
  ok("多签章节", docs.includes("2-of-3"));
  ok("曲线常数 16000", docs.includes("16000"));

  console.log("\n\x1b[1m结果：" + pass + " 通过 / " + fail + " 失败\x1b[0m");
  console.log("\x1b[90m余额 " + ethers.formatEther(await p.getBalance(w.address)) + " tBNB\x1b[0m");
})().catch((e) => console.error("FATAL", e.shortMessage || e.message));
