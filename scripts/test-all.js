/**
 * 全部测试总跑
 */
const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const suites = [
  ["test.js", "核心单元"],
  ["test-pools.js", "双池"],
  ["test-full.js", "全流程"],
  ["test-multisig3.js", "多签基础"],
  ["test-ms-rotation.js", "多签轮换"],
  ["test-audit-fixes.js", "审计修复回归"],
  ["test-medium-fixes.js", "Medium 修复回归"],
  ["test-idle-accrue.js", "空窗不累积"],
  ["test-escrow-invariants.js", "托管闭环"],
  ["test-handle-validation.js", "handle 校验"],
  ["test-mint-switch.js", "铸造开关"],
  ["test-pricing-gate.js", "阶梯定价+门槛"],
];

let totalPass = 0, totalFail = 0, failed = [];
console.log("\x1b[1m全部测试\x1b[0m\n");

for (const [file, name] of suites) {
  let out = "";
  try {
    out = execSync("node scripts/" + file, { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    out = (e.stdout || "") + (e.stderr || "");
  }
  const m = out.match(/结果：(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
  if (m) {
    const p = Number(m[1]), f = Number(m[2]);
    totalPass += p; totalFail += f;
    console.log("  " + (f === 0 ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m") + " " + name.padEnd(16) + p + " 通过 / " + f + " 失败");
    if (f > 0) failed.push(name);
  } else {
    console.log("  \x1b[33m?\x1b[0m " + name.padEnd(16) + "（无法解析结果）");
    failed.push(name + "(解析失败)");
  }
}

console.log("\n\x1b[1m合计：" + totalPass + " 通过 / " + totalFail + " 失败\x1b[0m");
if (failed.length) console.log("失败套件: " + failed.join(", "));
process.exit(totalFail ? 1 : 0);
