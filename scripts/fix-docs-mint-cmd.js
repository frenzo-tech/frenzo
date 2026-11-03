const fs = require("fs");
const path = require("path");
const p = path.join(__dirname, "..", "index.html");
let t = fs.readFileSync(p, "utf8");
let n = 0;
const rep = (a, b, label) => {
  if (t.includes(a)) { t = t.split(a).join(b); n++; console.log("✓ " + label); }
  else console.log("✗ 未匹配: " + label);
};

// 中文版铸造指令
rep(
  `帮我铸造 Frenzo 矿机。
调用：CityCore.mintMiner("{your-handle}")  // a-z 0-9 - ，1-24 字符
附带：value = 当前铸造价
铸造前先调用 mintPrice() 查到准确价格，不要用固定值。`,
  `帮我铸造 FRENZO 矿机
官网：https://frenzo.tech
合约：{core}
网络：BSC (chainId 56)
调用：mintMiner("{your-handle}")
金额：0.001 BNB`,
  "文档铸造指令 CN"
);

// 英文版
const enCandidates = [
  `Mint a Frenzo miner for me.
Call: CityCore.mintMiner("{your-handle}")  // a-z 0-9 - only, 1-24 chars
Attach: value = current mint price
Call mintPrice() first to get the exact price — do not hardcode it.`,
  `Mint a Frenzo miner.
Call: CityCore.mintMiner("{your-handle}")  // a-z 0-9 - only, 1-24 chars
Attach: value = current mint price
Call mintPrice() first to get the exact price — do not hardcode it.`,
];
for (const c of enCandidates) {
  if (t.includes(c)) {
    rep(c, `Mint a FRENZO miner
Site: https://frenzo.tech
Contract: {core}
Network: BSC (chainId 56)
Call: mintMiner("{your-handle}")
Amount: 0.001 BNB`, "文档铸造指令 EN");
    break;
  }
}

// 其他还带「先调用 mintPrice()」的段落
const leftovers = [];
t.split("\n").forEach((l, i) => {
  if (/mintPrice\(\)/.test(l) && /不要用固定值|don't hardcode|do not hardcode|先调用/.test(l)) {
    leftovers.push((i + 1) + ": " + l.trim().slice(0, 100));
  }
});
if (leftovers.length) {
  console.log("\n仍有「先查 mintPrice」的段落:");
  leftovers.forEach((x) => console.log("  " + x));
}

fs.writeFileSync(p, t, "utf8");
console.log("\n改动 " + n + " 处");
