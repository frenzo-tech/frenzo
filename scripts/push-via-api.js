/**
 * 用 GitHub Git Data API 推送（绕过 git over https 的网络问题）
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) { console.error("缺少 GH_TOKEN"); process.exit(1); }

const ROOT = path.join(__dirname, "..");
const OWNER = "k85026863-debug";
const REPO = "frenzo";
const BRANCH = "main";

function api(method, p, body) {
  return new Promise((res) => {
    const data = body ? JSON.stringify(body) : null;
    const req = require("https").request({
      hostname: "api.github.com", path: p, method,
      headers: {
        Authorization: "Bearer " + TOKEN,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "frenzo-push",
        ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
      },
      timeout: 60000,
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

const isBinary = (buf) => buf.includes(0);

(async () => {
  // 1. 拿 git ls-files 列表
  const list = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean);
  console.log("待推送 " + list.length + " 个文件");

  // 2. 逐个建 blob
  const tree = [];
  let done = 0, failed = 0;

  for (const rel of list) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const buf = fs.readFileSync(abs);

    let payload;
    if (isBinary(buf)) {
      payload = { content: buf.toString("base64"), encoding: "base64" };
    } else {
      payload = { content: buf.toString("utf8"), encoding: "utf-8" };
    }

    let r = await api("POST", `/repos/${OWNER}/${REPO}/git/blobs`, payload);
    // 大文件（>1MB）走 base64 更稳
    if (r.status !== 201 && !isBinary(buf)) {
      r = await api("POST", `/repos/${OWNER}/${REPO}/git/blobs`,
        { content: buf.toString("base64"), encoding: "base64" });
    }

    if (r.status === 201) {
      tree.push({ path: rel, mode: "100644", type: "blob", sha: r.json.sha });
    } else {
      console.log("  ✗ " + rel + "  HTTP " + r.status + "  " + (r.json && r.json.message));
      failed++;
    }
    done++;
    if (done % 40 === 0) console.log("  " + done + "/" + list.length);
  }
  console.log("blob 完成 " + tree.length + " 个，失败 " + failed);

  // 3. 建 tree
  console.log("\n建 tree…");
  const t = await api("POST", `/repos/${OWNER}/${REPO}/git/trees`, { tree });
  if (t.status !== 201) { console.error("失败: " + t.status + " " + t.raw); process.exit(1); }
  console.log("  tree sha " + t.json.sha);

  // 4. 建 commit
  console.log("\n建 commit…");
  const msg = `FRENZO: AI Agent 社交挖矿协议

BSC 主网合约 + 前端 + 工具链。

CityCore     0x3A3F5338B0D045Ffe5e759C6EbFa6489A896C35d
MinerNFT     0x85A2e86401bE72a71991EEbFe7041c4Ff6e49497
FRNZ         0xe3b2c45B59A651B077A7859a616FAc27fB6A347f
多签国库      0x7B447c9E30189C18d7C4eC19B566C45BCBeF0bCe

- 铸造价 0.001 BNB 起，每 1000 台 +0.001，封顶 0.05
- key 曲线用 friend.tech 原版 price = supply^2 * 1e18 / 16000
- 买卖各 10% 手续费，50% 给矿主、50% 进国库
- 好友前 10 个免费，之后 1 FRNZ 销毁
- 算力 = 好友 30% + key 70%
- 100,000,000 FRNZ 三年线性释放，零预挖
- 国库 2-of-3 多签，合约无提款函数`;

  const c = await api("POST", `/repos/${OWNER}/${REPO}/git/commits`, {
    message: msg, tree: t.json.sha, parents: [],
  });
  if (c.status !== 201) { console.error("失败: " + c.status + " " + c.raw); process.exit(1); }
  console.log("  commit " + c.json.sha);

  // 5. 建/更新 branch ref
  console.log("\n更新 main 分支…");
  let ref = await api("POST", `/repos/${OWNER}/${REPO}/git/refs`, {
    ref: "refs/heads/" + BRANCH, sha: c.json.sha,
  });
  if (ref.status !== 201) {
    ref = await api("PATCH", `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
      sha: c.json.sha, force: true,
    });
  }
  console.log("  HTTP " + ref.status);

  console.log("\n\x1b[32m✓ 推送完成\x1b[0m");
  console.log("  https://github.com/" + OWNER + "/" + REPO);
})();
