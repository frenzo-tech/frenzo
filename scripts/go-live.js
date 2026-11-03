/**
 * 切前端到主网（deployment-56.json → deployment-local.json）
 * 不动 nginx（rpc 上游由 switch-rpc-upstream.js 单独管）
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { Client } = require("ssh2");

const ROOT = path.join(__dirname, "..");
const HOST = process.env.FZ_HOST || "45.153.130.144";
const PASS = process.env.FZ_PASS || "";

const src = JSON.parse(fs.readFileSync(path.join(ROOT, "deployment-56.json"), "utf8"));
const live = process.argv.includes("--testnet")
  ? JSON.parse(fs.readFileSync(path.join(ROOT, "deployment-97.json"), "utf8"))
  : src;

const chainId = live.chainId || 56;
const NETNAME = chainId === 56 ? "BSC 主网" : "BSC 测试网";
const EXPLORER = chainId === 56 ? "https://bscscan.com" : "https://testnet.bscscan.com";

const cfg = {
  mode: chainId === 56 ? "live" : "demo",
  chainId,
  rpc: "/rpc/",
  explorer: EXPLORER,
  networkName: NETNAME,
  token: live.token,
  nft: live.nft,
  core: live.core,
  registry: live.registry,
  treasury: live.treasury,
  multisig: live.multisig || live.treasury,
  note: chainId === 56 ? "BSC 主网 · 正式环境" : "BSC 测试网 · 演示环境",
};

(async () => {
  // 先核对链上真的和配置一致
  const p = new ethers.JsonRpcProvider(live.rpc || "https://bsc-rpc.publicnode.com", undefined, { staticNetwork: true });
  const core = new ethers.Contract(cfg.core, require(path.join(ROOT, "artifacts/CityCore.json")).abi, p);

  const onchain = {
    chainId: Number((await p.getNetwork()).chainId),
    treasury: await core.treasury(),
    registry: await core.registry(),
    miners: Number(await core.minerCount()),
    open: await core.mintOpen(),
    price: ethers.formatEther(await core.mintPrice()),
  };

  console.log("\x1b[1m切换前核对\x1b[0m");
  const ok = [
    ["chainId", onchain.chainId === chainId],
    ["treasury 一致", onchain.treasury.toLowerCase() === cfg.treasury.toLowerCase()],
    ["registry 一致", onchain.registry.toLowerCase() === cfg.registry.toLowerCase()],
  ];
  for (const [n, v] of ok) console.log("  " + (v ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m") + " " + n);
  console.log("  矿机数   " + onchain.miners);
  console.log("  铸造开关 " + (onchain.open ? "开" : "关"));
  console.log("  当前价   " + onchain.price + " BNB");

  if (!ok.every(([, v]) => v)) {
    console.error("\n核对失败，中止切换");
    process.exit(1);
  }

  fs.writeFileSync(path.join(ROOT, "deployment-local.json"), JSON.stringify(cfg, null, 2), "utf8");
  console.log("\n已写 deployment-local.json（mode=" + cfg.mode + ", chainId=" + chainId + "）");

  const chain = {
    chainId, rpc: "/rpc/", explorer: EXPLORER,
    nft: cfg.nft, core: cfg.core, token: cfg.token, mode: cfg.mode,
  };
  fs.writeFileSync(path.join(ROOT, "_chain-sync.json"), JSON.stringify(chain, null, 2), "utf8");

  // 上传
  const c = new Client();
  await new Promise((r, j) => { c.on("ready", r); c.on("error", j);
    c.connect({ host: HOST, port: 22, username: "root", password: PASS, readyTimeout: 30000 }); });
  const sftp = await new Promise((r, j) => c.sftp((e, s) => (e ? j(e) : r(s))));
  const put = (l, r2) => new Promise((res, rej) => sftp.fastPut(l, r2, (e) => (e ? rej(e) : res())));
  const run = (cmd) => new Promise((res) => {
    c.exec(cmd, (e, st) => { let o = ""; st.on("data", (d) => (o += d)); st.on("close", () => res(o.trim())); });
  });

  await put(path.join(ROOT, "deployment-local.json"), "/var/www/frenzo/deployment-local.json");
  await put(path.join(ROOT, "_chain-sync.json"), "/var/www/frenzo/nft/chain.json");
  console.log("已上传 deployment-local.json + nft/chain.json");

  await run("rm -f /var/www/frenzo/nft/poster/* /var/www/frenzo/nft/thumb/* /var/www/frenzo/nft/video/*; systemctl restart frenzo-render");
  console.log("已清空海报/视频缓存（主网 0 台矿机，无需重渲染）");

  c.end();

  console.log("\n\x1b[1m切换完成\x1b[0m");
  console.log("  " + NETNAME + "  chainId " + chainId);
  console.log("  CityCore   " + cfg.core);
  console.log("  模式       " + cfg.mode + (cfg.mode === "live" ? "（演示横幅自动隐藏）" : "（显示演示横幅）"));
})();
