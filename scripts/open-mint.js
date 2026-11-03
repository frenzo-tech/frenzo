/**
 * 开卖开关 —— 主网上线那天手动执行
 *
 *   node scripts/open-mint.js --status    查看当前状态
 *   node scripts/open-mint.js --open      开启铸造
 *   node scripts/open-mint.js --close     关闭铸造
 *   node scripts/open-mint.js --renounce  放弃所有权（需先 open）
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..");
const arg = (k) => process.argv.includes("--" + k);

function loadCfg() {
  for (const f of ["deployment-56.json", "deployment-97.json"]) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) return { cfg: JSON.parse(fs.readFileSync(p, "utf8")), file: f };
  }
  throw new Error("找不到 deployment-56.json 或 deployment-97.json");
}

function loadKey() {
  let k = process.env.MAINNET_KEY || process.env.DEPLOY_KEY;
  if (!k) {
    for (const f of [".mainnetkey", ".testkey"]) {
      const p = path.join(ROOT, f);
      if (fs.existsSync(p)) { k = fs.readFileSync(p, "utf8").trim(); break; }
    }
  }
  if (!k) throw new Error("找不到部署者私钥");
  return k;
}

(async () => {
  const { cfg, file } = loadCfg();
  const p = new ethers.JsonRpcProvider(cfg.rpc, undefined, { staticNetwork: true });
  const core = new ethers.Contract(cfg.core, require(path.join(ROOT, "artifacts/CityCore.json")).abi, p);

  const owner = await core.owner();
  const open = await core.mintOpen();
  const miners = await core.minerCount();
  const price = await core.mintPrice();

  console.log("\n" + file + "  " + (cfg.networkName || cfg.chainId));
  console.log("  CityCore   " + cfg.core);
  console.log("  owner      " + owner);
  console.log("  mintOpen   " + (open ? "\x1b[32m开启\x1b[0m" : "\x1b[33m关闭\x1b[0m"));
  console.log("  矿机数      " + miners);
  console.log("  当前价      " + ethers.formatEther(price) + " BNB");
  console.log("");

  if (arg("status") || process.argv.length === 2) return;

  if (owner === ethers.ZeroAddress) {
    console.error("所有权已放弃，无法再变更开关。");
    process.exit(1);
  }

  const w = new ethers.Wallet(loadKey(), p);
  if (w.address.toLowerCase() !== owner.toLowerCase()) {
    console.error("当前私钥 " + w.address + " 不是 owner（" + owner + "）");
    process.exit(1);
  }

  const gp = (await p.getFeeData()).gasPrice;
  // 用 wallet 重新实例化（只读 provider 不能发交易）
  const coreW = new ethers.Contract(cfg.core, require(path.join(ROOT, "artifacts/CityCore.json")).abi, w);

  if (arg("open")) {
    if (open) { console.log("已经是开启状态"); return; }
    console.log("开启铸造…");
    await (await coreW.setMintOpen(true, { gasLimit: 120000, gasPrice: gp })).wait();
    console.log("\x1b[32m✓\x1b[0m mintOpen = " + (await core.mintOpen()));
    console.log("\n提醒：现在任何人只要能持有 Agent ID 就能铸。");
  }

  if (arg("close")) {
    if (!open) { console.log("已经是关闭状态"); return; }
    await (await coreW.setMintOpen(false, { gasLimit: 120000, gasPrice: gp })).wait();
    console.log("\x1b[32m✓\x1b[0m mintOpen = " + (await core.mintOpen()));
  }

  if (arg("renounce")) {
    if (!open) {
      console.error("铸造关闭时不允许 renounce（防止项目永久锁死）。先 --open。");
      process.exit(1);
    }
    console.log("\n放弃所有权是永久操作。10 秒后执行，Ctrl+C 取消…");
    await new Promise((r) => setTimeout(r, 10000));
    await (await coreW.renounceOwnership({ gasLimit: 80000, gasPrice: gp })).wait();
    console.log("\x1b[32m✓\x1b[0m owner = " + (await core.owner()) + "（已归零）");
  }
})().catch((e) => console.error("失败: " + (e.shortMessage || e.message)));
