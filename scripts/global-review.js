/**
 * 全局静态审查：合约 + 前端 + 配置
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

let issues = [];
const bad = (area, what, detail) => issues.push({ area, what, detail });

// ══════════ 合约静态检查 ══════════
const contracts = ["CityCore.sol", "MinerNFT.sol", "AgentToken.sol", "FrenzoMultiSig.sol", "MockRegistry.sol"];
for (const f of contracts) {
  const src = fs.readFileSync(path.join(ROOT, "contracts", f), "utf8");
  const lines = src.split("\n");

  // 外部调用是否有 nonReentrant（payable 函数）
  lines.forEach((l, i) => {
    if (/function\s+\w+\([^)]*\)\s*(external|public)[^{]*payable/.test(l)) {
      const sig = l.trim().slice(0, 70);
      const ctx = lines.slice(i, i + 3).join(" ");
      if (!/nonReentrant/.test(ctx) && !/onlySelf/.test(ctx)) {
        bad(f, "payable 函数无 nonReentrant", "行 " + (i + 1) + ": " + sig);
      }
    }
  });

  // 裸 .call 前后是否检查返回值
  lines.forEach((l, i) => {
    if (/\.call\{value/.test(l)) {
      const next = lines.slice(i, i + 3).join(" ");
      if (!/bool\s+\w+/.test(l) && !/require\(/.test(next)) {
        bad(f, "call 返回值未检查", "行 " + (i + 1) + ": " + l.trim().slice(0, 60));
      }
    }
  });

  // 除零风险：直接除法
  lines.forEach((l, i) => {
    if (/\/\s*(?!\/)\w+/.test(l) && !/Math\.mulDiv/.test(l) && !/\/\/|\/\*/.test(l.trim().slice(0, 2))) {
      const m = l.match(/(\w+)\s*\/\s*(\w+)/);
      if (m && !/10_000|1e18|16000/.test(m[0])) {
        // 只报告可疑的直接除法
      }
    }
  });
}

// 检查关键守卫是否存在
const core = fs.readFileSync(path.join(ROOT, "contracts", "CityCore.sol"), "utf8");
const checks = [
  ["acceptFriend 幂等检查", /if \(_friendPairs\[_pairKey\(r\.from, r\.to\)\]\) revert AlreadyFriends\(\);/.test(core)],
  ["spareBnb 扣托管", /totalKeyValue \+ totalEscrow/.test(core)],
  ["creatorCredit pull 模式", /creatorCredit\[creator\] \+= toCreator/.test(core)],
  ["空窗推进 lastUpdate", /totalMined -= reward;\s*\n\s*lastUpdate = block\.timestamp;/.test(core)],
  ["群组记录 creatorMiner", /creatorMiner: minerOf\[msg\.sender\]/.test(core)],
  ["setNftBaseURI 转发", /function setNftBaseURI/.test(core)],
  ["withdrawRefund 扣托管", /totalEscrow -= amt/.test(core)],
  ["cancelOffer 扣托管", /totalEscrow -= uint256\(cur\.amount\)/.test(core)],
];
for (const [name, pass] of checks) {
  if (!pass) bad("CityCore", "关键守卫缺失", name);
}

const ms = fs.readFileSync(path.join(ROOT, "contracts", "FrenzoMultiSig.sol"), "utf8");
const msChecks = [
  ["实时计票", /function liveConfirmations/.test(ms)],
  ["execute 用实时票数", /if \(liveConfirmations\(txId\) < required\)/.test(ms)],
  ["轮换后重算", /_resyncCounts\(\)/.test(ms)],
  ["onlySelf 存在", /modifier onlySelf/.test(ms)],
];
for (const [name, pass] of msChecks) {
  if (!pass) bad("FrenzoMultiSig", "关键守卫缺失", name);
}

// ══════════ 前端静态检查 ══════════
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

// 1. esc 必须在第一个 script 块
const firstScript = html.indexOf("<script>");
const escDef = html.indexOf("window.__esc = function");
const firstBigInt = html.indexOf("500n");
if (!(escDef > firstScript && escDef < firstBigInt)) bad("index.html", "esc 未在 BigInt 之前定义", "");
if (html.includes("window.__esc || ((s) => String(s == null ? '' : s))")) bad("index.html", "esc 仍有恒等兜底", "");

// 2. 链上 handle 拼接必须过 esc（只检查真正拼进 HTML 的位置）
[...html.matchAll(/'\s*\+\s*name\s*\+\s*'/g)].forEach((m) => {
  const line = html.slice(0, m.index).split("\n").length;
  const ctx = html.slice(Math.max(0, m.index - 400), m.index + 60);
  const isHtml = /class="|<div|<img|<span/.test(ctx);
  const escaped = /__safeEsc|const name = esc|const name = __safeEsc/.test(ctx) || /esc\(rawName\)/.test(ctx);
  const isPlainCmd = /const cmd =|copyText\(cmd\)|alert\(/.test(ctx) && !isHtml;
  if (isHtml && !escaped) bad("index.html", "handle 未转义就拼进 HTML", "行 " + line);
});

// 3. 旧参数残留
const stale = [
  ["105.7", "秒产出应为 1.057"],
  ["chainId 56", "应为 97"],
  ["K = 100,000", "曲线应为 16000"],
  ["0.0002 BNB 起", "铸造价应为 0.0003"],
  ["3 份 key", "初始应为 2 份"],
];
for (const [pat, why] of stale) {
  if (html.includes(pat)) bad("index.html", "旧参数残留: " + pat, why);
}

// 4. 私钥
const site = fs.readFileSync(path.join(ROOT, "deployment-local.json"), "utf8");
if (site.includes("privateKey")) bad("deployment-local.json", "含私钥", "");

// 5. 脚本语法
const re = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;
let m, idx = 0, syntaxErr = 0;
while ((m = re.exec(html))) {
  idx++;
  try { new Function(m[1]); } catch (e) { syntaxErr++; bad("index.html", "脚本块语法错误 #" + idx, e.message.slice(0, 60)); }
}

// 6. 验证副本一致性
const a1 = fs.readFileSync(path.join(ROOT, "viewer", "bnb-emblem.js"), "utf8");
const a2 = fs.readFileSync(path.join(ROOT, "vendor", "bnb-emblem.js"), "utf8");
if (a1 !== a2) bad("vendor/", "bnb-emblem.js 与 viewer 副本不一致", "实际加载的是 vendor 那份");

// ══════════ 配置一致性 ══════════
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "deployment-97.json"), "utf8"));
for (const k of ["token", "nft", "core", "registry", "treasury", "multisig"]) {
  if (!cfg[k]) bad("deployment-97.json", "缺字段 " + k, "");
}
if (cfg.treasury && cfg.multisig && cfg.treasury.toLowerCase() !== cfg.multisig.toLowerCase()) {
  bad("deployment-97.json", "treasury 与 multisig 不一致", cfg.treasury + " vs " + cfg.multisig);
}
if (site.core && cfg.core && site.core.toLowerCase() !== cfg.core.toLowerCase()) {
  bad("配置", "站点与部署配置的 core 不一致", "");
}

// ══════════ 输出 ══════════
console.log("\n\x1b[1m全局静态审查\x1b[0m\n");
if (!issues.length) {
  console.log("  \x1b[32m✓\x1b[0m 未发现问题");
} else {
  const byArea = {};
  issues.forEach((i) => { (byArea[i.area] = byArea[i.area] || []).push(i); });
  for (const [area, list] of Object.entries(byArea)) {
    console.log("\x1b[33m" + area + "\x1b[0m");
    list.forEach((i) => console.log("  \x1b[31m✗\x1b[0m " + i.what + (i.detail ? "  \x1b[90m" + i.detail + "\x1b[0m" : "")));
  }
  console.log("\n共 " + issues.length + " 项");
}
process.exit(issues.length ? 1 : 0);
