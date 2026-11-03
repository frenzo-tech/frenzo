const fs = require("fs");
const lines = fs.readFileSync("index.html", "utf8").split("\n");
for (let i = 3309; i < 3400; i++) {
  const l = lines[i - 1];
  if (l === undefined) break;
  console.log(i + "|" + l);
}
