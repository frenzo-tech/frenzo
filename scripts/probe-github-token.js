const https = require("https");
const TOKEN = process.env.GH_TOKEN;

function api(method, path, body) {
  return new Promise((res) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: "api.github.com", path, method,
      headers: {
        Authorization: "Bearer " + TOKEN,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "frenzo",
        ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
      },
      timeout: 30000,
    }, (r) => {
      let b = "";
      r.on("data", (d) => (b += d));
      r.on("end", () => {
        let j = null;
        try { j = JSON.parse(b); } catch (e) {}
        res({ status: r.statusCode, json: j, headers: r.headers, raw: b.slice(0, 400) });
      });
    });
    req.on("error", (e) => res({ status: 0, err: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log("=== 用户信息 ===");
  const me = await api("GET", "/user");
  console.log("  login  " + me.json.login);
  console.log("  id     " + me.json.id);

  console.log("\n=== 可访问的仓库 ===");
  const repos = await api("GET", "/user/repos?per_page=100&affiliation=owner,collaborator,organization_member");
  if (repos.status === 200) {
    console.log("  共 " + repos.json.length + " 个");
    repos.json.slice(0, 20).forEach((r) => {
      console.log("    " + r.full_name.padEnd(40) + (r.permissions && r.permissions.push ? "push" : "read"));
    });
  } else {
    console.log("  HTTP " + repos.status + " " + repos.raw);
  }

  console.log("\n=== 组织 ===");
  const orgs = await api("GET", "/user/orgs");
  if (orgs.status === 200 && orgs.json.length) {
    orgs.json.forEach((o) => console.log("  " + o.login));
  } else {
    console.log("  无");
  }

  console.log("\n=== 测试创建仓库（权限探测）===");
  const t = await api("POST", "/user/repos", { name: "_perm_probe_" + Date.now(), private: true, auto_init: true });
  if (t.status === 201) {
    console.log("  ✓ 可以创建！" + t.json.full_name);
    const del = await api("DELETE", "/repos/" + t.json.full_name);
    console.log("  清理探测仓库: HTTP " + del.status);
  } else {
    console.log("  ✗ HTTP " + t.status + "  " + (t.json && t.json.message));
    console.log("  需要的权限: Administration → Read and write（fine-grained token）");
  }

  console.log("\n=== 检查目标仓库是否已存在 ===");
  for (const name of ["frenzo", "FRENZO", "agent-city"]) {
    const r = await api("GET", "/repos/" + me.json.login + "/" + name);
    console.log("  " + name.padEnd(14) + (r.status === 200 ? "存在  " + r.json.html_url : "不存在"));
  }
})();
