const https = require("https");
const TOKEN = process.env.GH_TOKEN;
const OWNER = "k85026863-debug";
const REPO = "frenzo";

function api(method, p, body) {
  return new Promise((res) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: "api.github.com", path: p, method,
      headers: {
        Authorization: "Bearer " + TOKEN,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "probe",
        ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
      },
      timeout: 30000,
    }, (r) => {
      let b = "";
      r.on("data", (d) => (b += d));
      r.on("end", () => {
        let j = null;
        try { j = JSON.parse(b); } catch (e) {}
        res({ status: r.statusCode, json: j, headers: r.headers, raw: b.slice(0, 250) });
      });
    });
    req.on("error", (e) => res({ status: 0, err: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log("=== 仓库信息 ===");
  const r = await api("GET", `/repos/${OWNER}/${REPO}`);
  console.log("  HTTP " + r.status);
  if (r.json) {
    console.log("  full_name  " + r.json.full_name);
    console.log("  private    " + r.json.private);
    console.log("  empty      " + (r.json.size === 0));
    if (r.json.permissions) {
      console.log("  permissions " + JSON.stringify(r.json.permissions));
    }
  }

  console.log("\n=== 尝试写一个文件 ===");
  const w = await api("PUT", `/repos/${OWNER}/${REPO}/contents/_probe.txt`, {
    message: "probe",
    content: Buffer.from("hello").toString("base64"),
  });
  console.log("  HTTP " + w.status + "  " + (w.json && w.json.message || "ok"));

  console.log("\n=== 尝试读 contents 权限 ===");
  const rd = await api("GET", `/repos/${OWNER}/${REPO}/contents/`);
  console.log("  HTTP " + rd.status + "  " + (rd.json && rd.json.message || "ok"));

  console.log("\n=== token 自身信息 ===");
  const u = await api("GET", "/user");
  console.log("  login " + u.json.login);
  console.log("  建议检查的权限:");
  console.log("    Contents         → Read and write   ← 目前缺失");
  console.log("    Administration   → Read and write   ← 已有（能建仓库）");
})();
