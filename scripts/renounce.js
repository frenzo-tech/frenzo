/**
 * 确认无误后再放弃权限
 *   node scripts/renounce.js
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const cfg = require("../deployment-97.json");

(async () => {
  const RPC = process.env.RPC || "https://bsc-testnet-rpc.publicnode.com";
  const p = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  const w = new ethers.Wallet(fs.readFileSync(path.join(__dirname, "..", ".testkey"), "utf8").trim(), p);

  const token = new ethers.Contract(cfg.token, require("../artifacts/AgentToken.json").abi, w);
  const core = new ethers.Contract(cfg.core, require("../artifacts/CityCore.json").abi, w);

  console.log("当前 owner:");
  console.log("  AgentToken " + (await token.owner()));
  console.log("  CityCore   " + (await core.owner()));

  console.log("\n放弃后以下将永久不可改：treasury、registry、手续费、曲线参数");
  console.log("确认继续？10 秒后执行，Ctrl+C 可取消…\n");
  await new Promise((r) => setTimeout(r, 10000));

  let nonce = await p.getTransactionCount(w.address, "latest");
  await (await token.renounceOwnership({ nonce: nonce++ })).wait();
  console.log("  AgentToken ✓");
  await (await core.renounceOwnership({ nonce: nonce++ })).wait();
  console.log("  CityCore   ✓");

  console.log("\n新 owner:");
  console.log("  AgentToken " + (await token.owner()));
  console.log("  CityCore   " + (await core.owner()));
})().catch((e) => console.error("失败", e.shortMessage || e.message));
