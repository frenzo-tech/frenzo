/**
 * 最终部署：一条命令完成全部工作，配置与主网一致
 *
 *   node scripts/deploy-final.js
 *
 * 做的事：
 *   1. 部署 AgentToken / MinerNFT / MockRegistry / CityCore
 *   2. 绑定 minter 与 core
 *   3. registry 冒烟检查
 *   4. treasury 指向 2-of-3 多签
 *   5. 铸 12 台种子矿机
 *   6. 上传前端配置 + chain.json
 *   7. 清空海报，让渲染服务重新生成
 *
 * 不会做的事：放弃所有权（RENOUNCE=1 才做）
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { Client } = require("ssh2");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const RPC = process.env.RPC || "https://bsc-testnet-rpc.publicnode.com";
const HOST = process.env.FZ_HOST || "45.153.130.144";
const PASS = process.env.FZ_PASS || "";
const SEED = parseInt(process.env.SEED || "12", 10);
const MULTISIG = "0x20b8367C4e98c83f0aB2921a71773061c00a2e32";

const log = (...a) => console.log(...a);

(async () => {
  const p = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  const w = new ethers.Wallet(fs.readFileSync(path.join(ROOT, ".testkey"), "utf8").trim(), p);

  const bal = await p.getBalance(w.address);
  const fd = await p.getFeeData();
  const gasPrice = fd.gasPrice || ethers.parseUnits("0.1", "gwei");
  log("部署钱包 " + w.address);
  log("余额     " + ethers.formatEther(bal) + " tBNB");
  log("gasPrice " + ethers.formatUnits(gasPrice, "gwei") + " gwei\n");

  // ── 1. 部署合约 ──
  log("=== 1. 部署合约 ===");
  const out = execSync("node scripts/deploy.js", {
    cwd: ROOT, encoding: "utf8",
    env: { ...process.env, RPC, MIN_BALANCE: "0.0002" },
  });
  out.split("\n").filter((l) => l.includes("0x")).forEach((l) => log("  " + l.trim()));

  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "deployment-97.json"), "utf8"));
  const core = new ethers.Contract(cfg.core, require(path.join(ROOT, "artifacts/CityCore.json")).abi, w);
  const reg = new ethers.Contract(cfg.registry, require(path.join(ROOT, "artifacts/MockRegistry.json")).abi, w);
  const nft = new ethers.Contract(cfg.nft, require(path.join(ROOT, "artifacts/MinerNFT.json")).abi, p);

  // ── 2. 参数核对 ──
  log("\n=== 2. 参数核对（应与主网一致）===");
  const params = {
    "代币总量": ethers.formatEther(await core.MAX_SUPPLY()),
    "铸造价": ethers.formatEther(await core.mintPrice()) + " BNB",
    "初始份数": (await core.MINT_KEYS()).toString() + " 份",
    "曲线常数": (await core.CURVE_K()).toString(),
    "买卖费率": Number(await core.FEE_BPS()) / 100 + "%",
    "矿主分成": Number(await core.CREATOR_FEE_BPS()) / 100 + "% of fee",
    "免费好友": (await core.FRIEND_FREE()).toString(),
    "好友费": ethers.formatEther(await core.FRIEND_COST()) + " FRNZ",
    "NFT市场费": Number(await core.MARKET_FEE_BPS()) / 100 + "%",
  };
  for (const [k, v] of Object.entries(params)) log("  " + k.padEnd(10) + v);

  // ── 3. treasury → 多签 ──
  log("\n=== 3. 国库指向多签 ===");
  let nonce = await p.getTransactionCount(w.address, "latest");
  await (await core.setTreasury(MULTISIG, { gasLimit: 100000, gasPrice, nonce: nonce++ })).wait();
  log("  treasury = " + (await core.treasury()));
  log("  " + ((await core.treasury()).toLowerCase() === MULTISIG.toLowerCase() ? "✓" : "✗"));

  // ── 4. 种子矿机 ──
  log("\n=== 4. 铸造 " + SEED + " 台种子矿机 ===");
  // 合约默认关闭铸造，脚本铸种子前必须先开
  console.log("  开启铸造（脚本内部用，主网上线前需用 setMintOpen 控制）");
  await (await core.setMintOpen(true, { gasLimit: 120000 })).wait();

  const price = await core.mintPrice();
  // 按实时 gasPrice 计算每个种子钱包需要多少（铸造 value + 铸造 gas + 注册 gas + 余量）
  const fdNow = await p.getFeeData();
  const gpNow = fdNow.gasPrice || ethers.parseUnits("1", "gwei");
  const seedFund = price + gpNow * 950000n + gpNow * 150000n + gpNow * 300000n;
  console.log("  gasPrice " + ethers.formatUnits(gpNow, "gwei") + " gwei · 每个种子钱包 " + ethers.formatEther(seedFund) + " tBNB");
  const names = ["echo", "kite", "muse", "nova", "vega", "lyra", "orion", "iris",
                 "zeta", "flux", "halo", "juno", "kai", "luna", "mira", "neo"];
  const wallets = [];
  for (let i = 0; i < SEED; i++) {
    const c = ethers.Wallet.createRandom().connect(p);
    await (await w.sendTransaction({
      to: c.address, value: seedFund, gasLimit: 21000, gasPrice: gpNow, nonce: nonce++,
    })).wait();
    const h = names[i % names.length] + (i + 1);
    await (await reg.connect(c).set(h, c.address, { gasLimit: 180000, gasPrice: gpNow })).wait();
    await (await core.connect(c).mintMiner(h, { value: price, gasLimit: 1000000, gasPrice: gpNow })).wait();
    wallets.push({ c, id: i + 1, h });
    process.stdout.write("\r  已铸 " + (i + 1) + "/" + SEED);
  }
  log("\n  矿机总数 " + (await core.minerCount()));

  // ── 5. 好友 + 群组 ──
  log("\n=== 5. 建立好友与群组 ===");
  let edges = 0;
  for (let i = 0; i < Math.min(8, SEED - 3); i++) {
    const a = wallets[i], b = wallets[(i + 3) % SEED];
    const rc = await (await core.connect(a.c).requestFriend(b.id, { gasLimit: 300000, gasPrice })).wait();
    let rid;
    for (const lg of rc.logs) { try { const pl = core.interface.parseLog(lg); if (pl && pl.name === "FriendRequested") rid = pl.args[0]; } catch {} }
    if (rid === undefined) continue;
    await (await core.connect(b.c).acceptFriend(rid, { gasLimit: 400000, gasPrice })).wait();
    edges++;
  }
  log("  好友 " + edges + " 条");

  if (SEED >= 2) {
    await (await core.connect(wallets[0].c).createGroup("份额猎手", { gasLimit: 400000, gasPrice })).wait();
    await (await core.connect(wallets[1].c).createGroup("早期矿工", { gasLimit: 400000, gasPrice })).wait();
    log("  群组 " + (await core.groupCount()));
  }

  // ── 6. 写配置 ──
  log("\n=== 6. 更新配置 ===");
  cfg.treasury = await core.treasury();
  cfg.multisig = MULTISIG;
  fs.writeFileSync(path.join(ROOT, "deployment-97.json"), JSON.stringify(cfg, null, 2), "utf8");

  const siteDemo = JSON.parse(fs.readFileSync(path.join(ROOT, "deployment-local.json"), "utf8"));
  siteDemo.chainId = 97;
  siteDemo.rpc = RPC;
  siteDemo.token = cfg.token;
  siteDemo.nft = cfg.nft;
  siteDemo.core = cfg.core;
  siteDemo.registry = cfg.registry;
  siteDemo.treasury = cfg.treasury;
  siteDemo.multisig = MULTISIG;
  fs.writeFileSync(path.join(ROOT, "deployment-local.json"), JSON.stringify(siteDemo, null, 2), "utf8");

  const chain = { chainId: 97, rpc: "/rpc/", nft: cfg.nft, core: cfg.core, token: cfg.token };
  fs.writeFileSync(path.join(ROOT, "_chain-final.json"), JSON.stringify(chain, null, 2), "utf8");

  // ── 7. 上传 ──
  log("\n=== 7. 上传到服务器 ===");
  const conn = new Client();
  await new Promise((r, j) => { conn.on("ready", r); conn.on("error", j);
    conn.connect({ host: HOST, port: 22, username: "root", password: PASS, readyTimeout: 25000 }); });
  const sftp = await new Promise((r, j) => conn.sftp((e, s) => (e ? j(e) : r(s))));
  const put = (l, r) => new Promise((res, rej) => sftp.fastPut(l, r, (e) => (e ? rej(e) : res())));

  await put(path.join(ROOT, "deployment-local.json"), "/var/www/frenzo/deployment-local.json");
  await put(path.join(ROOT, "_chain-final.json"), "/var/www/frenzo/nft/chain.json");
  log("  站点配置 + chain.json 已更新");

  const run = (cmd) => new Promise((res) => {
    conn.exec(cmd, (e, st) => { let o = ""; st.on("data", (d) => (o += d)); st.on("close", () => res(o.trim())); });
  });
  await run("rm -f /var/www/frenzo/nft/poster/* /var/www/frenzo/nft/thumb/*; systemctl restart frenzo-render");
  log("  海报已清空，渲染服务重启");

  conn.end();

  // ── 8. 汇总 ──
  log("\n===== 部署完成 =====");
  log("AgentToken  " + cfg.token);
  log("MinerNFT    " + cfg.nft);
  log("CityCore    " + cfg.core);
  log("MockRegistry " + cfg.registry + "  （主网换成真实 SPACE ID）");
  log("多签国库     " + MULTISIG);
  log("矿机        " + (await core.minerCount()) + " 台");
  log("余额        " + ethers.formatEther(await p.getBalance(w.address)) + " tBNB");
  log("\n所有权未放弃；确认稳定后运行 node scripts/renounce.js");
})().catch((e) => console.error("FATAL", e.shortMessage || e.message));
