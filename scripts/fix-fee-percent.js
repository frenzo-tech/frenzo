const fs = require("fs");
const path = require("path");
const p = path.join(__dirname, "..", "index.html");
let t = fs.readFileSync(p, "utf8");
let n = 0;
const rep = (a, b, label) => {
  if (t.includes(a)) { t = t.split(a).join(b); n++; console.log("✓ " + label); }
  else console.log("✗ 未匹配: " + label);
};

// ── 1. 英文三方角色表：协议收入 ──
rep(
  `<tr><td>Protocol</td><td>Nothing</td><td>5% fee on each share trade</td></tr>`,
  `<tr><td>Protocol</td><td>Nothing</td><td>10% fee on each share trade (half to miner owner)</td></tr>`,
  "EN 三方角色-协议"
);

// ── 2. 竞品对比表：两种 5% 费用 ──
rep(
  `<tr><td>Revenue source</td><td>Selling tokens / endless skimming</td><td>Mint fee + two 5% fees</td></tr>`,
  `<tr><td>Revenue source</td><td>Selling tokens / endless skimming</td><td>Mint fee + 10% trade fees</td></tr>`,
  "EN 对比表-收入"
);

// ── 3. EN 买 key 旧版（另一处）──
rep(
  `3. Fee = cost × 5%
4. Call buyShares({id}, {amount}) with value = cost + fee</pre>`,
  `3. Fee = cost × 10%
4. Call buyShares({id}, {amount}) with value = cost + fee</pre>`,
  "EN 买 key 旧版"
);

// ── 4. EN 参数表：手续费 ──
rep(
  `<tr><td>Share buy fee</td><td>cost × 5%</td><td>Treasury</td></tr>`,
  `<tr><td>Share buy fee</td><td>cost × 10%</td><td>50% to miner owner / 50% treasury</td></tr>`,
  "EN 参数表-买"
);
rep(
  `<tr><td>Share sell fee</td><td>buyback × 5%</td><td>Treasury</td></tr>`,
  `<tr><td>Share sell fee</td><td>buyback × 10%</td><td>50% to miner owner / 50% treasury</td></tr>`,
  "EN 参数表-卖"
);

// ── 5. EN 参数表总览：交易费 ──
rep(
  `<tr><td>Trade fee</td><td>5% each side</td><td>To treasury</td></tr>`,
  `<tr><td>Trade fee</td><td>10% each side</td><td>Half to miner owner, half to treasury</td></tr>`,
  "EN 参数表总览"
);

fs.writeFileSync(p, t, "utf8");
console.log("\n改动 " + n + " 处");

// 终检：所有「5%」出现的位置
console.log("\n=== 所有含 5% 的行（人工确认）===");
t.split("\n").forEach((l, i) => {
  if (l.includes("5%")) {
    const s = l.trim();
    if (s && s.length < 160 && !/^\s*[.#]/.test(s) && !s.startsWith(".feed")) {
      console.log("  " + (i + 1) + ": " + s.slice(0, 140));
    }
  }
});
