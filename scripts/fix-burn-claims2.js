const fs = require("fs");
const path = require("path");
const p = path.join(__dirname, "..", "index.html");
let t = fs.readFileSync(p, "utf8");
let n = 0;
const rep = (a, b, label) => {
  if (t.includes(a)) { t = t.split(a).join(b); n++; console.log("✓ " + label); }
  else console.log("✗ 未匹配: " + label);
};

rep(
  `<p class="dim">80% of treasury revenue buys back and burns $FRNZ (executed manually). The platform takes coins off the market instead of pocketing the cash.</p>`,
  `<p class="dim">Half of each fee goes straight to the miner owner, half to the 2-of-3 multisig treasury. Treasury spending is up to the multisig holders — the contract does no automatic buyback, and <code>router</code> is currently unset on mainnet, so buyback-and-burn is disabled.</p>`,
  "EN 回购说明 1"
);

rep(
  `<p class="dim">Treasury revenue = mint fees + both 5% trade fees. 80% of it buys back and burns $FRNZ (executed manually). The curve principal always stays in the contract, so anyone can sell at the curve price.</p>`,
  `<p class="dim">Treasury revenue = mint fees + half of every 10% trade fee. The other half goes straight to the miner owner. Treasury spending is up to the 2-of-3 multisig holders; the contract has no automatic buyback and <code>router</code> is currently unset. The curve principal always stays in the contract, so anyone can sell at the curve price.</p>`,
  "EN 回购说明 2"
);

fs.writeFileSync(p, t, "utf8");
console.log("\n改动 " + n + " 处");

// 终检
const checks = [
  [/80%[^<\n]{0,20}(销毁|回购)/, "80% 销毁/回购（CN）"],
  [/80%[^<\n]{0,30}(buyback|burn)/i, "80% buyback/burn（EN）"],
  [/两道 5%/, "两道 5%"],
  [/two 5% fees/i, "two 5% fees"],
  [/cost × 5%/, "cost × 5%"],
  [/buyback × 5%/, "buyback × 5%"],
];
console.log("\n=== 终检 ===");
let bad = 0;
for (const [re, label] of checks) {
  t.split("\n").forEach((l, i) => {
    if (re.test(l)) { console.log("  ✗ 行 " + (i + 1) + " [" + label + "] " + l.trim().slice(0, 110)); bad++; }
  });
}
console.log(bad ? "\n共 " + bad + " 处残留" : "\n✓ 全部清除");

const re2 = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;
let m, i = 0, e2 = 0;
while ((m = re2.exec(t))) { i++; try { new Function(m[1]); } catch (e) { e2++; } }
console.log(i + " 段脚本，" + (e2 ? e2 + " 有问题" : "全部 OK"));
