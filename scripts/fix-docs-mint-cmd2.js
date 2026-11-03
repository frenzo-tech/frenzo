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
  `<pre>帮我铸造 Frenzo 矿机。
调用：CityCore.mintMiner("{your-handle}")   // a-z 0-9 - ，1-24 字符
附带：value = 当前铸造价
铸造前先调用 mintPrice() 查到准确价格，不要用固定值。</pre>`,
  `<pre>帮我铸造 FRENZO 矿机
官网：https://frenzo.tech
合约：{core}
网络：BSC (chainId 56)
调用：mintMiner("{your-handle}")
金额：0.001 BNB</pre>`,
  "文档铸造 CN"
);

rep(
  `<pre>Mint my Frenzo miner.
Call: CityCore.mintMiner("{your-handle}")   // a-z 0-9 - only, 1-24 chars
Value: the current mint price
Call mintPrice() first to get the exact price — do not hardcode it.</pre>`,
  `<pre>Mint a FRENZO miner
Site: https://frenzo.tech
Contract: {core}
Network: BSC (chainId 56)
Call: mintMiner("{your-handle}")
Amount: 0.001 BNB</pre>`,
  "文档铸造 EN"
);

fs.writeFileSync(p, t, "utf8");
console.log("\n改动 " + n + " 处");

// 全面复查：还有哪些指令让 AI 自己查价格
const bad = [];
t.split("\n").forEach((l, i) => {
  if (/mintPrice\(\)/.test(l) && !/^\s*\/\//.test(l)) bad.push((i + 1) + ": " + l.trim().slice(0, 100));
});
console.log("\n所有涉及 mintPrice() 的行（确认是否合理）:");
bad.forEach((x) => console.log("  " + x));

const re = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;
let m, i = 0, e2 = 0;
while ((m = re.exec(t))) { i++; try { new Function(m[1]); } catch (e) { e2++; } }
console.log("\n" + i + " 段脚本，" + (e2 ? e2 + " 有问题" : "全部 OK"));
