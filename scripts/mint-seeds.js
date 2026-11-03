/**
 * 补铸种子矿机（按实时 gas 定价）
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const cfg = require("../deployment-97.json");
const RPC = "https://bsc-testnet-rpc.publicnode.com";
const SEED = parseInt(process.env.SEED || "12", 10);

(async () => {
  const p = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  const w = new ethers.Wallet(fs.readFileSync(path.join(__dirname, "..", ".testkey"), "utf8").trim(), p);
  const fd = await p.getFeeData();
  const gp = fd.gasPrice || ethers.parseUnits("1", "gwei");

  const core = new ethers.Contract(cfg.core, require("../artifacts/CityCore.json").abi, w);
  const reg = new ethers.Contract(cfg.registry, require("../artifacts/MockRegistry.json").abi, w);

  const price = await core.mintPrice();
  const mintGas = gp * 950000n;
  const fund = price + mintGas + gp * 300000n;
  console.log("gasPrice " + ethers.formatUnits(gp, "gwei") + " gwei");
  console.log("每个种子钱包充值 " + ethers.formatEther(fund) + " tBNB");
  console.log("铸造价 " + ethers.formatEther(price) + " · 铸造 gas " + ethers.formatEther(mintGas));
  console.log("余额 " + ethers.formatEther(await p.getBalance(w.address)) + "\n");

  const have = Number(await core.minerCount());
  const names = ["echo", "kite", "muse", "nova", "vega", "lyra", "orion", "iris",
                 "zeta", "flux", "halo", "juno", "kai", "luna", "mira", "neo"];
  let nonce = await p.getTransactionCount(w.address, "latest");
  const wallets = [];

  for (let i = have; i < SEED; i++) {
    const c = ethers.Wallet.createRandom().connect(p);
    await (await w.sendTransaction({ to: c.address, value: fund, gasLimit: 21000, gasPrice: gp, nonce: nonce++ })).wait();
    const h = names[i % names.length] + (i + 1);
    await (await reg.connect(c).set(h, c.address, { gasLimit: 150000, gasPrice: gp })).wait();
    await (await core.connect(c).mintMiner(h, { value: price, gasLimit: 950000, gasPrice: gp })).wait();
    wallets.push({ c, id: i + 1 });
    process.stdout.write("\r  已铸 " + (i + 1) + "/" + SEED);
  }
  console.log("\n矿机总数 " + (await core.minerCount()));

  // 好友 + 群组
  console.log("\n建立好友关系…");
  const all = [];
  const n = Number(await core.minerCount());
  for (let id = 1; id <= n; id++) all.push(id);
  let edges = 0;
  // 需要私钥，只有本次铸的才有 → 用能控制的那些
  for (let i = 0; i < wallets.length && i + 3 < wallets.length; i++) {
    const a = wallets[i], b = wallets[i + 3];
    const rc = await (await core.connect(a.c).requestFriend(b.id, { gasLimit: 300000, gasPrice: gp })).wait();
    let rid;
    for (const lg of rc.logs) { try { const pl = core.interface.parseLog(lg); if (pl && pl.name === "FriendRequested") rid = pl.args[0]; } catch {} }
    if (rid === undefined) continue;
    await (await core.connect(b.c).acceptFriend(rid, { gasLimit: 400000, gasPrice: gp })).wait();
    edges++;
  }
  console.log("  好友 " + edges + " 条 · 单位 " + (await core.totalFriendUnits()));

  if (wallets.length >= 2) {
    await (await core.connect(wallets[0].c).createGroup("份额猎手", { gasLimit: 400000, gasPrice: gp })).wait();
    await (await core.connect(wallets[1].c).createGroup("早期矿工", { gasLimit: 400000, gasPrice: gp })).wait();
    console.log("  群组 " + (await core.groupCount()));
  }

  console.log("\n余额 " + ethers.formatEther(await p.getBalance(w.address)));
})().catch((e) => console.error("FATAL", e.shortMessage || e.message));
