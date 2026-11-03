const fs = require("fs");
const path = require("path");
const p = path.join(__dirname, "..", "index.html");
let t = fs.readFileSync(p, "utf8");
let n = 0;
const rep = (a, b, label) => {
  if (t.includes(a)) { t = t.split(a).join(b); n++; console.log("✓ " + label); }
  else console.log("✗ 未匹配: " + label);
};

// 英文版「常用指令 → Mint」
rep(
  `<pre>Mint my miner.
1. Read mintPrice()
2. Call mintMiner("{your-handle}") with value = that price
handle: a-z, 0-9, hyphen only, 1-24 chars
3. Tell me the miner id</pre>`,
  `<pre>Mint a FRENZO miner
Site: https://frenzo.tech
Contract: {core}
Network: BSC (chainId 56)
Call: mintMiner("{your-handle}")
Amount: 0.001 BNB</pre>`,
  "EN 常用指令-铸造"
);

// 英文版加好友
rep(
  `<pre>Add miner #{id} as a friend.
1. Find my own id with minerOf(my address)
2. Call requestFriend({id})
3. From the 11th friend on it costs 1 FRNZ — approve it to CityCore first</pre>`,
  `<pre>Add miner #{id} as a friend
Site: https://frenzo.tech
Contract: {core}
Network: BSC (chainId 56)
Call: requestFriend({id})</pre>`,
  "EN 常用指令-加好友"
);

// 英文版领取
rep(
  `<pre>Claim my earnings for miner #{id}.
1. Check pendingOf({id})
2. If above 0, call claim({id})</pre>`,
  `<pre>Claim earnings for miner #{id}
Site: https://frenzo.tech
Contract: {core}
Network: BSC (chainId 56)
Call: claim({id})</pre>`,
  "EN 常用指令-领取"
);

// 英文版挂单
rep(
  `<pre>List miner #{id} for {price} BNB.
1. Claim first: claim({id})
2. MinerNFT.approve(CityCore, {id})
3. CityCore.listMiner({id}, {price in wei})

Note: 5% to treasury on sale, 95% to me. Cancel with unlistMiner({id})</pre>`,
  `<pre>List miner #{id} for {price} BNB
Site: https://frenzo.tech
Contract: {core}
Network: BSC (chainId 56)
Call: approve first, then listMiner({id}, {price in wei})</pre>`,
  "EN 常用指令-挂单"
);

// 英文版买矿机
rep(
  `<pre>Buy miner #{id}.
1. listingOf({id}) to confirm it is for sale and get the price
2. Call buyMiner({id}) with value = price
3. Note: one miner per address — fails if I already have one</pre>`,
  `<pre>Buy miner #{id} ({price} BNB)
Site: https://frenzo.tech
Contract: {core}
Network: BSC (chainId 56)
Call: buyMiner({id})
Amount: {price} BNB</pre>`,
  "EN 常用指令-买矿机"
);

fs.writeFileSync(p, t, "utf8");
console.log("\n改动 " + n + " 处");

const re = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;
let m, i = 0, e2 = 0;
while ((m = re.exec(t))) { i++; try { new Function(m[1]); } catch (e) { e2++; } }
console.log(i + " 段脚本，" + (e2 ? e2 + " 有问题" : "全部 OK"));
