const fs = require("fs");
const path = require("path");
const p = path.join(__dirname, "..", "index.html");
let t = fs.readFileSync(p, "utf8");
let n = 0;
const rep = (a, b, label) => {
  if (t.includes(a)) { t = t.split(a).join(b); n++; console.log("✓ " + label); }
  else console.log("✗ 未匹配: " + label);
};

// ══ 1. 标题：两道 5% + 80% 销毁 → 一道 10%，一半给矿主 ══
rep(
  `<h2>一、平台只收两道 5%，其中 80% 拿去销毁</h2>`,
  `<h2>一、每笔交易收 10%，一半直接分给矿机主人</h2>`,
  "标题 CN"
);

// ══ 2. 平台只收 5% → 10% ══
rep(
  `平台只在每笔交易上收 5%，再加上铸造价。`,
  `平台在每笔交易上收 10%，再加上铸造价。`,
  "正文 5%→10%"
);

// ══ 3. 80% 回购销毁（中文两处）══
rep(
  `<p class="dim">金库收入的 80% 用于回购并销毁 $FRNZ（手动执行）。平台不是把钱装进口袋，是把币从市场上买走烧掉。</p>`,
  `<p class="dim">手续费一半直接打给矿机主人，一半进 2-of-3 多签国库。国库资金由多签持有人决定用途，合约层不做自动回购——当前主网 <code>router</code> 未设置，回购销毁功能处于关闭状态。</p>`,
  "回购说明 CN"
);

rep(
  `<tr><td>手续费用途</td><td>进团队口袋</td><td>80% 回购销毁</td></tr>`,
  `<tr><td>手续费用途</td><td>进团队口袋</td><td>50% 给矿机主人，50% 进多签国库</td></tr>`,
  "对比表 CN"
);

rep(
  `<p>平台只收两道 5% 和铸造价，其中 80% 回购销毁——钱回到代币本身，而不是进谁的口袋。</p>`,
  `<p>平台只收铸造价和 10% 交易费，其中一半当场分给矿机主人——大部分收入流向做产品的人，而不是协议。</p>`,
  "结尾 CN"
);

// ══ 4. 英文对应 ══
rep(
  `<p class="dim">80% of treasury revenue buys back and burns $FRNZ (executed manually). The platform takes coins off the market instead of pocketing them.</p>`,
  `<p class="dim">Half of each fee goes straight to the miner owner, half to the 2-of-3 multisig treasury. Treasury spending is up to the multisig holders — there is no automatic buyback in the contract, and <code>router</code> is currently unset on mainnet, so buyback-and-burn is disabled.</p>`,
  "回购说明 EN"
);

rep(
  `<tr><td>What fees do</td><td>Into the team's pocket</td><td>80% buyback and burn</td></tr>`,
  `<tr><td>What fees do</td><td>Into the team's pocket</td><td>50% to miner owner, 50% to multisig treasury</td></tr>`,
  "对比表 EN"
);

rep(
  `<p>The platform takes two 5% fees and the mint fee, then burns 80% of it — value returns to the token instead of someone's pocket.</p>`,
  `<p>The platform takes the mint fee plus a 10% trade fee, half of which goes straight to the miner owner — most revenue flows to the people building, not to the protocol.</p>`,
  "结尾 EN"
);

fs.writeFileSync(p, t, "utf8");
console.log("\n改动 " + n + " 处");

// 终检
console.log("\n=== 残留的 80%/销毁 相关 ===");
let bad = 0;
t.split("\n").forEach((l, i) => {
  if (/80%/.test(l) && /销毁|burn|回购/i.test(l)) {
    console.log("  ✗ " + (i + 1) + ": " + l.trim().slice(0, 130));
    bad++;
  }
});
console.log(bad ? "  共 " + bad + " 处" : "  ✓ 无");
