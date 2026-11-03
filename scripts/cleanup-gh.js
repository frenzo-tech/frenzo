const https = require("https");
const T = process.env.GH_TOKEN;

function api(method, path) {
  return new Promise((res) => {
    const req = https.request({
      hostname: "api.github.com", path, method,
      headers: {
        Authorization: "Bearer " + T,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "cleanup",
      },
      timeout: 30000,
    }, (r) => {
      let b = "";
      r.on("data", (d) => (b += d));
      r.on("end", () => {
        let j = null;
        try { j = JSON.parse(b); } catch (e) {}
        res({ status: r.statusCode, json: j });
      });
    });
    req.on("error", (e) => res({ status: 0, err: e.message }));
    req.end();
  });
}

(async () => {
  const list = await api("GET", "/user/repos?per_page=100&affiliation=owner");
  const repos = Array.isArray(list.json) ? list.json : [];
  console.log("=== 账户下的仓库 ===");
  repos.forEach((r) => console.log("  " + r.full_name + "  (size " + r.size + ")"));

  console.log("\n=== 清理探测仓库 ===");
  const probes = repos.filter((r) => r.name.startsWith("_perm_probe_"));
  if (!probes.length) console.log("  无");
  for (const r of probes) {
    const d = await api("DELETE", "/repos/" + r.full_name);
    console.log("  " + r.full_name + "  → HTTP " + d.status);
  }
})();
