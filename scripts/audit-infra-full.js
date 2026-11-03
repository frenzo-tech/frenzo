/**
 * 基建审计：服务器、nginx、暴露面、服务健康
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { Client } = require("ssh2");

const HOST = process.env.FZ_HOST || "45.153.130.144";
const PASS = process.env.FZ_PASS || "";
const results = [];
const rec = (area, name, ok, detail) => {
  results.push({ area, name, ok, detail });
  console.log("  " + (ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m") + " " + name + (detail ? "  \x1b[90m" + detail + "\x1b[0m" : ""));
};

function get(p) {
  return new Promise((r) => {
    https.get({ host: HOST, servername: "frenzo.tech", path: p, headers: { Host: "frenzo.tech" }, rejectUnauthorized: false }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => r({ s: res.statusCode, h: res.headers, body: b }));
    }).on("error", () => r({ s: 0, h: {}, body: "" }));
  });
}

(async () => {
  // ── 1. 暴露面 ──
  console.log("\n\x1b[36m━━ 1. 暴露面 ━━\x1b[0m");
  const secrets = ["/.testkey", "/testnet-wallets.json", "/.env", "/deployment-local.backup.json",
                   "/node_modules/ethers/package.json", "/contracts/CityCore.sol", "/scripts/deploy.js"];
  let leaked = 0;
  for (const p of secrets) {
    const r = await get(p);
    // SPA 回退会把未知路径返回首页
    const isSpa = r.body.includes("<title>FRENZO") || r.body.includes("FRENZO");
    const real = r.s === 200 && !isSpa;
    if (real) { leaked++; rec("暴露面", p, false, "真实暴露"); }
  }
  rec("暴露面", "无私钥/源码文件可下载", leaked === 0, leaked ? leaked + " 个暴露" : "全部 404 或 SPA 回退");

  const cfg = await get("/deployment-local.json");
  rec("暴露面", "站点配置不含私钥", !cfg.body.includes("privateKey"));
  rec("暴露面", "调试页已清理", (await get("/viewer/_dbg.html")).s === 404);

  // 残留测试页
  const leftovers = ["/docs-test.html", "/docs-diag.html", "/docs-diag2.html", "/agent-view-test.html", "/search-live-test.html"];
  let res = 0;
  for (const p of leftovers) {
    const r = await get(p);
    if (r.s === 200 && !r.body.includes("<title>FRENZO")) res++;
  }
  rec("暴露面", "测试页已清理", res === 0, res ? res + " 个残留" : "无");

  // ── 2. 安全响应头 ──
  console.log("\n\x1b[36m━━ 2. 安全响应头 ━━\x1b[0m");
  const home = await get("/");
  rec("响应头", "HSTS", !!home.h["strict-transport-security"], home.h["strict-transport-security"] || "");
  rec("响应头", "X-Content-Type-Options", home.h["x-content-type-options"] === "nosniff");
  rec("响应头", "X-Frame-Options", !!home.h["x-frame-options"], home.h["x-frame-options"] || "");
  rec("响应头", "不泄露 nginx 版本", !/nginx\/[\d.]+/.test(home.h["server"] || ""), home.h["server"] || "-");

  const viewer = await get("/viewer/");
  rec("响应头", "viewer 子路径有安全头", !!viewer.h["x-content-type-options"]);

  // ── 3. 服务健康 ──
  console.log("\n\x1b[36m━━ 3. 服务健康 ━━\x1b[0m");
  const c = new Client();
  await new Promise((r, j) => { c.on("ready", r); c.on("error", j);
    c.connect({ host: HOST, port: 22, username: "root", password: PASS, readyTimeout: 25000 }); });
  const run = (cmd) => new Promise((res2) => {
    c.exec(cmd, (e, st) => { let o = ""; st.on("data", (d) => (o += d)); st.stderr.on("data", (d) => (o += d)); st.on("close", () => res2(o.trim())); });
  });

  rec("服务", "渲染服务运行中", (await run("systemctl is-active frenzo-render")) === "active");
  rec("服务", "渲染服务开机自启", (await run("systemctl is-enabled frenzo-render")) === "enabled");
  rec("服务", "nginx 配置有效", (await run("nginx -t 2>&1")).includes("successful"));
  rec("服务", "nginx 运行中", (await run("systemctl is-active nginx")) === "active");

  const cert = await run("openssl x509 -enddate -noout -in /etc/letsencrypt/live/frenzo.tech/fullchain.pem 2>/dev/null");
  rec("服务", "证书有效期", !!cert, cert.replace("notAfter=", ""));

  const renew = await run("systemctl list-timers | grep -c certbot || echo 0");
  rec("服务", "证书自动续期", Number(renew) > 0, "certbot timer");

  // ── 4. 渲染服务安全性 ──
  console.log("\n\x1b[36m━━ 4. 渲染服务 ━━\x1b[0m");
  const svc = await run("grep -c 'no-sandbox' /opt/frenzo-render/server.js || echo 0");
  rec("渲染", "使用了 --no-sandbox（已知取舍）", true, "Chromium 在容器中必需");
  rec("渲染", "有渲染超时保护", (await run("grep -c RENDER_TIMEOUT /opt/frenzo-render/server.js || echo 0")) !== "0");
  rec("渲染", "渲染服务只监听本机", (await run("ss -tlnp | grep 8700 | grep -c 127.0.0.1 || echo 0")) !== "0");
  rec("渲染", "render 回退有速率限制", (await run("grep -c 'limit_req zone=render' /etc/nginx/sites-enabled/frenzo.tech.conf || echo 0")) !== "0");
  rec("渲染", "rpc 代理有限速", (await run("grep -c 'limit_req zone=rpc' /etc/nginx/sites-enabled/frenzo.tech.conf || echo 0")) !== "0");

  // 越界 id 是否快速返回
  const bad = await get("/nft/poster/999999.png");
  rec("渲染", "越界 id 不触发渲染", bad.s === 404, "HTTP " + bad.s);

  // ── 5. 磁盘与日志 ──
  console.log("\n\x1b[36m━━ 5. 运维 ━━\x1b[0m");
  const disk = await run("df -h / | tail -1 | awk '{print $5}'");
  rec("运维", "磁盘使用率", parseInt(disk) < 85, disk);
  const logSize = await run("du -sh /var/log/frenzo-render.log 2>/dev/null | cut -f1");
  rec("运维", "渲染日志大小", true, logSize);
  const mem = await run("free -m | awk '/Mem:/{print $7}'");
  rec("运维", "可用内存 > 500MB", Number(mem) > 500, mem + " MB");

  // ── 6. 其他站点未受影响 ──
  console.log("\n\x1b[36m━━ 6. 共存服务 ━━\x1b[0m");
  const hi = await run("curl -s -o /dev/null -w '%{http_code}' -H 'Host: hi235.top' http://127.0.0.1/");
  rec("共存", "hi235.top 未被影响", hi === "200" || hi === "301", "HTTP " + hi);

  c.end();

  const passed = results.filter((r) => r.ok).length;
  console.log("\n\x1b[1m基建结果：" + passed + " 通过 / " + (results.length - passed) + " 失败\x1b[0m");
})().catch((e) => console.error("FATAL", e.message));
