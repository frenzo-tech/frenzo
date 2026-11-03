/**
 * 一键切网：demo（测试网展示） ⇄ live（主网正式）
 *
 * 用法:
 *   node scripts/switch-network.js --status
 *   node scripts/switch-network.js --demo
 *   node scripts/switch-network.js --live            (读 deployment-56.json)
 *   node scripts/switch-network.js --live --core 0x.. --nft 0x.. --token 0x.. --registry 0x.. --treasury 0x..
 *
 * 两种模式的区别只在一个文件：deployment-local.json
 * 页面、渲染服务、viewer 全部从它派生，切它 = 全站切换。
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { Client } = require("ssh2");

const ROOT = path.join(__dirname, "..");
const HOST = process.env.FZ_HOST || "45.153.130.144";
const PASS = process.env.FZ_PASS || "";

const NET = {
  97: { name: "BSC 测试网", rpc: "https://bsc-testnet-rpc.publicnode.com", explorer: "https://testnet.bscscan.com" },
  56: { name: "BSC 主网", rpc: "https://bsc-rpc.publicnode.com", explorer: "https://bscscan.com" },
};

const arg = (k, d) => {
  const i = process.argv.indexOf("--" + k);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};
const has = (k) => process.argv.includes("--" + k);

async function status() {
  const c = JSON.parse(fs.readFileSync(path.join(ROOT, "deployment-local.json"), "utf8"));
  console.log("\n当前配置 deployment-local.json");
  console.log("  mode      " + (c.mode || "(未设置)"));
  console.log("  chainId   " + c.chainId + "  " + (NET[c.chainId]?.name || "未知链"));
  console.log("  rpc       " + c.rpc);
  console.log("  core      " + c.core);
  console.log("  nft       " + c.nft);
  console.log("  token     " + c.token);
  console.log("  registry  " + c.registry);
  console.log("  treasury  " + c.treasury);

  // 链上核对
  try {
    const p = new ethers.JsonRpcProvider(c.rpc, undefined, { staticNetwork: true });
    const net = await p.getNetwork();
    const core = new ethers.Contract(c.core, require(path.join(ROOT, "artifacts/CityCore.json")).abi, p);
    const [miners, mined, treasury] = await Promise.all([core.minerCount(), core.totalMined(), core.treasury()]);
    console.log("\n  链上核对  chainId=" + net.chainId + (Number(net.chainId) === c.chainId ? " ✓" : " ✗ 不匹配"));
    console.log("            矿机 " + miners + " 台 · 已挖 " + ethers.formatEther(mined) + " FRNZ");
    console.log("            treasury " + treasury + (treasury.toLowerCase() === c.treasury.toLowerCase() ? " ✓" : " ✗ 不一致"));
  } catch (e) {
    console.log("\n  链上核对失败: " + (e.shortMessage || e.message).slice(0, 70));
  }
  console.log("");
}

function buildConfig(chainId, o) {
  const net = NET[chainId];
  if (!net) throw new Error("不支持的 chainId " + chainId);
  for (const k of ["core", "nft", "token", "registry", "treasury"]) {
    if (!o[k]) throw new Error("缺少 " + k);
    if (!ethers.isAddress(o[k])) throw new Error(k + " 不是合法地址: " + o[k]);
  }
  return {
    mode: chainId === 56 ? "live" : "demo",
    chainId,
    rpc: "/rpc/",              // 前端走 nginx 代理，不直连公共节点
    rpcUpstream: net.rpc,      // nginx 上游用真实节点
    explorer: net.explorer,
    networkName: net.name,
    token: o.token,
    nft: o.nft,
    core: o.core,
    registry: o.registry,
    treasury: o.treasury,
    multisig: o.multisig || o.treasury,
    note: chainId === 56 ? "BSC 主网 · 正式环境" : "BSC 测试网 · 演示环境",
  };
}

async function writeAndDeploy(cfg) {
  const localPath = path.join(ROOT, "deployment-local.json");
  const prev = fs.existsSync(localPath) ? fs.readFileSync(localPath, "utf8") : null;

  fs.writeFileSync(localPath, JSON.stringify(cfg, null, 2), "utf8");
  console.log("\n已写入 deployment-local.json（mode=" + cfg.mode + ", chainId=" + cfg.chainId + "）");

  // chain.json 由它派生（viewer + 渲染服务读这个）
  const chain = { chainId: cfg.chainId, rpc: "/rpc/", explorer: cfg.explorer, nft: cfg.nft, core: cfg.core, token: cfg.token, mode: cfg.mode };
  fs.writeFileSync(path.join(ROOT, "_chain-sync.json"), JSON.stringify(chain, null, 2), "utf8");

  // 上传
  const c = new Client();
  await new Promise((r, j) => { c.on("ready", r); c.on("error", j);
    c.connect({ host: HOST, port: 22, username: "root", password: PASS, readyTimeout: 25000 }); });
  const sftp = await new Promise((r, j) => c.sftp((e, s) => (e ? j(e) : r(s))));
  const put = (l, r2) => new Promise((res, rej) => sftp.fastPut(l, r2, (e) => (e ? rej(e) : res())));
  const run = (cmd) => new Promise((res) => {
    c.exec(cmd, (e, st) => { let o = ""; st.on("data", (d) => (o += d)); st.on("close", () => res(o.trim())); });
  });

  await put(localPath, "/var/www/frenzo/deployment-local.json");
  await put(path.join(ROOT, "_chain-sync.json"), "/var/www/frenzo/nft/chain.json");
  console.log("已上传 deployment-local.json + nft/chain.json");

  // rpc 代理要指向新链
  const rpcCfg = `location /rpc/ {
    limit_req zone=rpc burst=20 nodelay;
    proxy_pass ${cfg.rpcUpstream.replace(/\/$/, "")}/;
    proxy_http_version 1.1;
    proxy_set_header Host $proxy_host;
    proxy_set_header Content-Type application/json;
    proxy_ssl_server_name on;
    proxy_read_timeout 30s;
}`;
  await run(`cat > /etc/nginx/snippets/frenzo-rpc.conf <<'EOF'
${rpcCfg}
EOF
grep -q 'frenzo-rpc.conf' /etc/nginx/sites-enabled/frenzo.tech.conf || sed -i 's|# RPC_PLACEHOLDER|include /etc/nginx/snippets/frenzo-rpc.conf;|' /etc/nginx/sites-enabled/frenzo.tech.conf;
nginx -t 2>&1 | tail -1 && systemctl reload nginx`);
  console.log("rpc 代理已指向 " + cfg.rpcUpstream + "（前端用 /rpc/）");

  // 清海报（元数据里的 miner 数据变了）
  await run("rm -f /var/www/frenzo/nft/poster/* /var/www/frenzo/nft/thumb/*; systemctl restart frenzo-render");
  console.log("海报已清空，渲染服务重启");

  // 验证
  const check = await run(`curl -s http://127.0.0.1/ -H 'Host: frenzo.tech' | grep -o 'deployment-local.json' | head -1; curl -s http://127.0.0.1/deployment-local.json -H 'Host: frenzo.tech' | head -c 200`);
  console.log("\n线上配置验证:");
  console.log("  " + check.replace(/\n/g, "\n  "));

  c.end();

  if (prev) {
    fs.writeFileSync(path.join(ROOT, "_deployment-local.prev.json"), prev, "utf8");
    console.log("\n旧配置已备份到 _deployment-local.prev.json");
  }
}

(async () => {
  if (has("status") || process.argv.length === 2) return status();

  if (has("demo")) {
    const c = JSON.parse(fs.readFileSync(path.join(ROOT, "deployment-local.json"), "utf8"));
    const cfg = buildConfig(97, c);
    await writeAndDeploy(cfg);
    console.log("\n✅ 已切到演示模式（测试网 chainId 97）");
    return;
  }

  if (has("live")) {
    let src;
    const f56 = path.join(ROOT, "deployment-56.json");
    if (fs.existsSync(f56)) {
      src = JSON.parse(fs.readFileSync(f56, "utf8"));
      console.log("读取 deployment-56.json");
    } else {
      src = {
        core: arg("core"), nft: arg("nft"), token: arg("token"),
        registry: arg("registry"), treasury: arg("treasury"), multisig: arg("multisig"),
      };
    }
    const cfg = buildConfig(56, src);
    await writeAndDeploy(cfg);
    console.log("\n✅ 已切到正式模式（主网 chainId 56）");
    console.log("\n下一步:");
    console.log("  1. 确认合约已在 BscScan 验证源码");
    console.log("  2. 铸造种子矿机: node scripts/mint-seeds.js");
    console.log("  3. 刷新快照: node scripts/gen-project-snapshot.js");
    console.log("  4. 处理 mint 阶段（Closed → Whitelist → Public）");
    return;
  }

  console.log("用法:");
  console.log("  node scripts/switch-network.js --status");
  console.log("  node scripts/switch-network.js --demo");
  console.log("  node scripts/switch-network.js --live        (需 deployment-56.json)");
})();
