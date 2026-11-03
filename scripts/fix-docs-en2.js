const fs = require("fs");
const path = require("path");
const p = path.join(__dirname, "..", "index.html");
let t = fs.readFileSync(p, "utf8");
let n = 0;
const rep = (a, b, label) => {
  if (t.includes(a)) { t = t.split(a).join(b); n++; console.log("✓ " + label); }
  else console.log("✗ 未匹配: " + label);
};

// ── 英文铸造 ──
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
Amount: 0.001 BNB</pre>`, "EN 铸造");

// ── 英文加好友 ──
rep(
`<pre>Friend miner #{target}.
1. Look up my id with minerOf(my address)
2. Call requestFriend({target})
3. From the 11th friend, approve 1 FRNZ to CityCore first</pre>`,
`<pre>Add miner #{target} as a friend
Site: https://frenzo.tech
Contract: {core}
Network: BSC (chainId 56)
Call: requestFriend({target})</pre>`, "EN 加好友");

// ── 英文买/卖 key（手续费 5% 是错的，应为 10%）──
rep(
`<pre>Buy {amount} keys of miner #{id}.
1. minerInfo({id}) for current supply
2. costToBuy(supply, supply+{amount}) for the cost
3. fee = cost × 5%
4. buyShares({id}, {amount}) with value = cost + fee

Selling: sellShares({id}, {amount})</pre>`,
`<pre>Buy {amount} keys of miner #{id}
Site: https://frenzo.tech
Contract: {core}
Network: BSC (chainId 56)
Call: buyShares({id}, {amount})
Amount: cost + 10% fee（合约会按 costToBuy 自行核算）</pre>`, "EN 买 key");

// ── 英文领取 ──
rep(
`<pre>Claim my rewards for miner #{id}.
1. pendingOf({id})
2. If above 0, call claim({id})</pre>`,
`<pre>Claim rewards for miner #{id}
Site: https://frenzo.tech
Contract: {core}
Network: BSC (chainId 56)
Call: claim({id})</pre>`, "EN 领取");

// ── 英文挂单 ──
rep(
`<pre>List miner #{id} for {price} BNB.
1. claim({id}) first to take unclaimed rewards
2. MinerNFT.approve(CityCore, {id})
3. CityCore.listMiner({id}, {price in wei})

5% goes to treasury, 95% to me. Cancel with unlistMiner({id}).</pre>`,
`<pre>List miner #{id} for {price} BNB
Site: https://frenzo.tech
Contract: {core}
Network: BSC (chainId 56)
Call: approve first, then listMiner({id}, {price in wei})</pre>`, "EN 挂单");

// ── 英文买矿机 ──
rep(
`<pre>Buy miner #{id}.
1. listingOf({id}) to confirm it is listed and get the price
2. buyMiner({id}) with value = price
3. One address can only own one miner — it fails if I already have one</pre>`,
`<pre>Buy miner #{id} ({price} BNB)
Site: https://frenzo.tech
Contract: {core}
Network: BSC (chainId 56)
Call: buyMiner({id})
Amount: {price} BNB</pre>`, "EN 买矿机");

fs.writeFileSync(p, t, "utf8");
console.log("\n改动 " + n + " 处");

// 复查：所有 5% 手续费相关说明
console.log("\n=== 手续费说明复查 ===");
t.split("\n").forEach((l, i) => {
  if (/(fee|手续费|fee = |× 5%|5% 给矿机主人|× 10%)/.test(l) && l.trim().length < 130 && !/^\s*<\/?div/.test(l)) {
    console.log("  " + (i + 1) + ": " + l.trim().slice(0, 110));
  }
});
