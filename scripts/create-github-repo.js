/**
 * 用 GitHub API 创建仓库
 */
const https = require("https");

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) { console.error("缺少 GH_TOKEN"); process.exit(1); }

const NAME = process.argv[2] || "frenzo";
const DESC = "AI Agent 社交挖矿协议 · BNB Chain · Solidity + 3D viewer + poster renderer";

function api(method, path, body) {
  return new Promise((res) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: "api.github.com",
      path,
      method,
      headers: {
        "Authorization": "Bearer " + TOKEN,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "frenzo-deploy",
        ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
      },
      timeout: 30000,
    }, (r) => {
      let b = "";
      r.on("data", (d) => (b += d));
      r.on("end", () => {
        let j = null;
        try { j = JSON.parse(b); } catch (e) {}
        res({ status: r.statusCode, json: j, raw: b.slice(0, 300) });
      });
    });
    req.on("error", (e) => res({ status: 0, err: e.message }));
    req.on("timeout", () => { req.destroy(); res({ status: 0, err: "timeout" }); });
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log("=== 验证 token ===");
  const me = await api("GET", "/user");
  if (me.status !== 200) {
    console.error("token 无效: HTTP " + me.status + " " + me.raw);
    process.exit(1);
  }
  const login = me.json.login;
  console.log("  用户 " + login + (me.json.name ? "  (" + me.json.name + ")" : ""));
  console.log("  类型 " + me.json.type);

  console.log("\n=== 检查仓库是否已存在 ===");
  const exist = await api("GET", "/repos/" + login + "/" + NAME);
  if (exist.status === 200) {
    console.log("  已存在: " + exist.json.full_name + "  " + exist.json.html_url);
    console.log("  默认分支: " + exist.json.default_branch);
    return;
  }
  console.log("  不存在，开始创建");

  console.log("\n=== 创建仓库 ===");
  const created = await api("POST", "/user/repos", {
    name: NAME,
    description: DESC,
    homepage: "https://frenzo.tech",
    private: false,
    has_issues: true,
    has_wiki: false,
    has_projects: false,
    auto_init: false,
  });

  if (created.status !== 201) {
    console.error("  失败: HTTP " + created.status + "  " + created.raw);
    process.exit(1);
  }
  console.log("  ✓ 已创建");
  console.log("  " + created.json.html_url);
  console.log("  clone: " + created.json.clone_url);
  console.log("  push:  " + created.json.clone_url.replace("https://", "https://" + TOKEN + "@"));
})();
