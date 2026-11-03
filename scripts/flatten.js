/**
 * 把合约 flatten 成单文件（内联所有 import），用于 BscScan 源码验证
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONTRACTS = path.join(ROOT, "contracts");
const NM = path.join(ROOT, "node_modules");
const OUT = path.join(ROOT, "verify");
fs.mkdirSync(OUT, { recursive: true });

const seen = new Set();

function resolve(imp, fromFile) {
  // 相对路径
  if (imp.startsWith(".")) {
    let p = path.resolve(path.dirname(fromFile), imp);
    if (!p.endsWith(".sol")) p += ".sol";
    return p;
  }
  // node_modules 包路径
  const p = path.join(NM, imp.endsWith(".sol") ? imp : imp + ".sol");
  return p;
}

function flatten(file, depth = 0) {
  const abs = path.resolve(file);
  if (seen.has(abs)) return "";
  seen.add(abs);
  if (!fs.existsSync(abs)) return `// 缺失: ${abs}\n`;

  let src = fs.readFileSync(abs, "utf8");
  const lines = src.split("\n");
  const out = [];
  const pending = [];

  for (const line of lines) {
    const m = line.match(/^\s*import\s+(?:[^"']*from\s+)?["']([^"']+)["']/);
    if (m) {
      const target = resolve(m[1], abs);
      pending.push(target);
      out.push(`// ── import ${m[1]} ──`);
      continue;
    }
    // 去掉 SPDX 和 pragma（只保留一份，在最后统一加）
    if (/^\s*\/\/\s*SPDX-License-Identifier/.test(line)) continue;
    if (/^\s*pragma\s+solidity/.test(line)) { out.push(`// pragma: ${line.trim()}`); continue; }
    if (/^\s*pragma\s+abicoder/.test(line)) continue;
    out.push(line);
  }

  const header = `\n// ═══════════════════════════════════════════════════════════════\n// ${path.relative(ROOT, abs).replace(/\\/g, "/")}\n// ═══════════════════════════════════════════════════════════════\n`;
  let result = header + out.join("\n") + "\n";

  for (const t of pending) {
    result += flatten(t, depth + 1);
  }
  return result;
}

const TARGETS = [
  ["CityCore", ["Math", "ReentrancyGuard", "Ownable", "AgentToken", "MinerNFT"]],
  ["MinerNFT", []],
  ["AgentToken", []],
  ["FrenzoMultiSig", []],
];

console.log("flatten 结果\n");
for (const [name] of TARGETS) {
  seen.clear();
  const body = flatten(path.join(CONTRACTS, name + ".sol"));
  const full = `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n${body}`;
  const f = path.join(OUT, name + ".flat.sol");
  fs.writeFileSync(f, full, "utf8");
  const lines = full.split("\n").length;
  console.log("  " + name.padEnd(16) + (full.length / 1024).toFixed(1).padStart(8) + " KB  " + String(lines).padStart(6) + " 行");
}

// 检查是否有未解析的 import
console.log("\n残留 import 检查:");
for (const f of fs.readdirSync(OUT).filter((x) => x.endsWith(".flat.sol"))) {
  const t = fs.readFileSync(path.join(OUT, f), "utf8");
  const bad = t.split("\n").filter((l) => /^\s*import\s/.test(l) && !l.trim().startsWith("//"));
  console.log("  " + f.padEnd(26) + (bad.length ? "\x1b[31m" + bad.length + " 条\x1b[0m" : "\x1b[32m✓ 无\x1b[0m"));
}
