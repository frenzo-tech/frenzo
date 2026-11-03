const fs = require("fs");
const t = fs.readFileSync("index.html", "utf8").split("\n");

console.log("=== 销毁 / burn 相关 ===");
t.forEach((l, i) => {
  if (/销毁|burn|Burn|回购/.test(l) && l.trim().length < 170) {
    console.log("  " + (i + 1) + ": " + l.trim().slice(0, 150));
  }
});

console.log("\n=== 1930-1936（首页统计卡）===");
console.log(t.slice(1929, 1936).map((l, i) => (1930 + i) + ": " + l.trim().slice(0, 120)).join("\n"));
