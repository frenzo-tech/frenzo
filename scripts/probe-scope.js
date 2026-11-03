const https = require("https");
const T = process.env.GH_TOKEN;

function api(method, path, body) {
  return new Promise((res) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: "api.github.com", path, method,
      headers: {
        Authorization: "Bearer " + T,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "probe2",
        ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
      },
      timeout: 30000,
    }, (r) => {
      let b = "";
      r.on("data", (d) => (b += d));
      r.on("end", () => {
        let j = null;
        try { j = JSON.parse(b); } catch (e) {}
        res({ status: r.statusCode, json: j, raw: b.slice(0, 200) });
      });
    });
    req.on("error", (e) => res({ status: 0, err: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log("=== token 能看到的仓库 ===");
  const list = await api("GET", "/user/repos?per_page=100&affiliation=owner");
  const repos = Array.isArray(list.json) ? list.json : [];
  repos.forEach((r) => console.log("  " + r.full_name));

  console.log("\n=== 逐个测试写入权限 ===");
  for (const r of repos) {
    const w = await api("PUT", `/repos/${r.full_name}/contents/_probe_${Date.now()}.txt`, {
      message: "probe",
      content: Buffer.from("x").toString("base64"),
    });
    console.log("  " + r.full_name.padEnd(42) + "写 HTTP " + w.status + "  " + (w.json && w.json.message || "✓ 成功"));
  }

  console.log("\n=== 结论 ===");
  const owner = repos.map((r) => r.full_name);
  if (!owner.includes("k85026863-debug/frenzo")) {
    console.log("  frenzo 不在 token 可见范围 → token 是「仅选定仓库」模式");
    console.log("  解决：token 设置里把 Repository access 改成 All repositories");
    console.log("        或者把 frenzo 加进 Selected repositories 列表");
  } else {
    console.log("  frenzo 可见但写不进去 → Contents 权限未开");
  }
})();
