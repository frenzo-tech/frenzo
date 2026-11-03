/**
 * 主网部署脚本 —— 与测试网脚本完全分离
 *
 * 设计原则：
 *   1. 部署者（deployer）只需要是普通钱包 + BNB，不需要 Agent ID
 *   2. 不铸造任何种子矿机 —— 铸多少完全由真实 Agent 用户决定
 *   3. mintOpen 部署后保持关闭，由你手动选择时机开启
 *   4. registry 固定为币安真实的 Agent ID 合约
 *
 * 用法：
 *   node scripts/deploy-mainnet.js --dry        先用测试网模拟一遍
 *   node scripts/deploy-mainnet.js              正式部署到 BSC 主网
 *
 * 环境变量：
 *   MAINNET_KEY      部署者私钥（不设则读 .mainnetkey 文件）
 *   MULTISIG         已有 2-of-3 多签地址（不设则新建）
 *   FZ_HOST/FZ_PASS  服务器上传（不设则跳过上传）
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..");
const DRY = process.argv.includes("--dry");

const NET = {
  chainId: 56,
  name: "BSC 主网",
  rpc: process.env.RPC_MAINNET || "https://bsc-mainnet.public.blastapi.io",
  explorer: "https://bscscan.com",
};

// 币安 SPACE ID Agent ID —— 主网真实合约（已实测：balanceOf / ownerOfHandle / handleOf 都可用）
const AGENT_ID = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";

// 多签 owner（你现有的三个币安 MPC 钱包）
const MS_OWNERS = [
  "0xA322C480C9807e452f0F05C8071a433BfD9bfFcc",
  "0x150CE419A354C22e8fc88295CF49163B3c880685",
  "0xebFb760700b6E4A7DafBbb5faCD8A68bA78ff925",
];

const log = (s) => console.log(s);

(async () => {
  // ── 1. 读部署者私钥 ──
  let key = process.env.MAINNET_KEY;
  if (!key) {
    const f = path.join(ROOT, ".mainnetkey");
    if (fs.existsSync(f)) key = fs.readFileSync(f, "utf8").trim();
  }
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error("缺少部署者私钥。设 MAINNET_KEY 或写 .mainnetkey 文件。");
    process.exit(1);
  }

  const rpc = DRY ? "https://bsc-testnet-rpc.publicnode.com" : NET.rpc;
  const FALLBACKS = [
    "https://bsc-mainnet.public.blastapi.io",
    "https://1rpc.io/bnb",
    "https://bsc-rpc.publicnode.com",
    "https://bsc.meowrpc.com",
  ];
  console.log("  RPC         " + rpc);
  const chainId = DRY ? 97 : NET.chainId;
  const p = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  const w = new ethers.Wallet(key, p);

  log("\x1b[1mFRENZO " + (DRY ? "试运行（测试网）" : "主网部署") + "\x1b[0m\n");

  const bal = await p.getBalance(w.address);
  log("  部署者      " + w.address);
  log("  余额        " + ethers.formatEther(bal) + " BNB");
  log("  链          " + (DRY ? "BSC 测试网 (97)" : NET.name + " (56)"));
  log("  Agent ID    " + AGENT_ID + (DRY ? "  \x1b[90m（试运行时用 MockRegistry）\x1b[0m" : ""));

  if (!DRY && bal < ethers.parseEther("0.02")) {
    console.error("\n  余额不足：需要至少 0.02 BNB（实际约 0.013 BNB）");
    process.exit(1);
  }

  const netGp = (await p.getFeeData()).gasPrice || ethers.parseUnits("0.05", "gwei");
  const MIN_GP = ethers.parseUnits("1", "gwei");
  const gp = netGp > MIN_GP ? netGp : MIN_GP;
  log("  gasPrice    " + ethers.formatUnits(gp, "gwei") + " gwei");
  log("");

  // ── 2. 预检：确认 registry 可用 ──
  log("\x1b[1m[1/6] 预检注册表\x1b[0m");
  let registryAddr = AGENT_ID;
  const art = (n) => require(path.join(ROOT, "artifacts", n + ".json"));

  if (DRY) {
    const regArt = art("MockRegistry");
    const reg = await new ethers.ContractFactory(regArt.abi, regArt.bytecode, w).deploy({
      gasLimit: 500000, gasPrice: gp,
    });
    await reg.waitForDeployment();
    registryAddr = await reg.getAddress();
    log("  测试网用 MockRegistry: " + registryAddr);
  } else {
    const probe = new ethers.Contract(registryAddr, [
      "function name() view returns (string)",
      "function symbol() view returns (string)",
      "function balanceOf(address) view returns (uint256)",
      "function ownerOfHandle(string) view returns (address)",
    ], p);
    const nm = await probe.name();
    const sym = await probe.symbol();
    log("  " + nm + " (" + sym + ")  " + (nm === "SPACE ID Agent ID" ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗ 名称不符\x1b[0m"));
    // 抽查已知 handle
    const binance = await probe.ownerOfHandle("binance");
    log("  ownerOfHandle(\"binance\") = " + binance + (binance !== ethers.ZeroAddress ? "  \x1b[32m✓\x1b[0m" : "  \x1b[31m✗\x1b[0m"));
  }

  // ── 3. 多签国库 ──
  log("\n\x1b[1m[2/6] 多签国库\x1b[0m");
  let multisig = process.env.MULTISIG || "";
  if (multisig && ethers.isAddress(multisig)) {
    log("  使用已有: " + multisig);
  } else {
    const msArt = art("FrenzoMultiSig");
    const ms = await new ethers.ContractFactory(msArt.abi, msArt.bytecode, w).deploy(MS_OWNERS, 2, {
      gasLimit: 2500000, gasPrice: gp,
    });
    await ms.waitForDeployment();
    multisig = await ms.getAddress();
    log("  新建 2-of-3: " + multisig);
    for (const o of MS_OWNERS) log("    owner " + o);
  }

  // ── 4. 部署三个核心合约 ──
  log("\n\x1b[1m[3/6] 部署合约\x1b[0m");
  const tokenArt = art("AgentToken");
  const nftArt = art("MinerNFT");
  const coreArt = art("CityCore");

  const token = await new ethers.ContractFactory(tokenArt.abi, tokenArt.bytecode, w).deploy({
    gasLimit: 1500000, gasPrice: gp,
  });
  await token.waitForDeployment();
  log("  AgentToken  " + (await token.getAddress()));

  const nft = await new ethers.ContractFactory(nftArt.abi, nftArt.bytecode, w).deploy({
    gasLimit: 3500000, gasPrice: gp,
  });
  await nft.waitForDeployment();
  log("  MinerNFT    " + (await nft.getAddress()));

  const core = await new ethers.ContractFactory(coreArt.abi, coreArt.bytecode, w).deploy(
    await token.getAddress(), await nft.getAddress(), registryAddr, multisig,
    { gasLimit: 5500000, gasPrice: gp }
  );
  await core.waitForDeployment();
  const coreAddr = await core.getAddress();
  log("  CityCore    " + coreAddr);
  log("  treasury    " + (await core.treasury()));

  // ── 5. 权限绑定 ──
  log("\n\x1b[1m[4/6] 权限绑定\x1b[0m");
  await (await token.setMinter(coreAddr, { gasLimit: 120000, gasPrice: gp })).wait();
  log("  token.minter = CityCore  " + ((await token.minter()).toLowerCase() === coreAddr.toLowerCase() ? "✓" : "✗"));
  await (await nft.setCore(coreAddr, { gasLimit: 120000, gasPrice: gp })).wait();
  log("  nft.core     = CityCore  " + ((await nft.core()).toLowerCase() === coreAddr.toLowerCase() ? "✓" : "✗"));

  // ── 6. 参数核对（不铸种子）──
  log("\n\x1b[1m[5/6] 参数核对\x1b[0m");
  const checks = [
    ["mintOpen（应为 false）", (await core.mintOpen()) === false],
    ["首档价 0.001", (await core.BASE_MINT_PRICE()) === ethers.parseEther("0.001")],
    ["档位 1000", (await core.MINT_STEP_SIZE()) === 1000n],
    ["每档 +0.001", (await core.MINT_STEP_AMOUNT()) === ethers.parseEther("0.001")],
    ["封顶 0.05", (await core.MINT_PRICE_CAP()) === ethers.parseEther("0.05")],
    ["铸造价 = 0.001", (await core.mintPrice()) === ethers.parseEther("0.001")],
    ["赠送 2 份 key", (await core.MINT_KEYS()) === 2n],
    ["矿机数 = 0", (await core.minerCount()) === 0n],
    ["已挖 = 0", (await core.totalMined()) === 0n],
    ["所有权在部署者", (await core.owner()).toLowerCase() === w.address.toLowerCase()],
    ["注册表正确", (await core.registry()).toLowerCase() === registryAddr.toLowerCase()],
  ];
  let okCount = 0;
  for (const [name, pass] of checks) {
    log("  " + (pass ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m") + " " + name);
    if (pass) okCount++;
  }
  log("  " + okCount + "/" + checks.length);

  // ── 7. 写配置 ──
  log("\n\x1b[1m[6/6] 写配置\x1b[0m");
  const cfgFile = DRY ? "deployment-97.json" : "deployment-56.json";
  const cfg = {
    mode: DRY ? "demo" : "live",
    chainId,
    rpc,
    explorer: DRY ? "https://testnet.bscscan.com" : NET.explorer,
    networkName: DRY ? "BSC 测试网" : NET.name,
    token: await token.getAddress(),
    nft: await nft.getAddress(),
    core: coreAddr,
    registry: registryAddr,
    treasury: multisig,
    multisig,
    mintOpen: false,
    deployedAt: new Date().toISOString(),
    deployer: w.address,
    note: DRY ? "试运行产物" : "主网正式部署，未铸造任何种子矿机",
  };
  fs.writeFileSync(path.join(ROOT, cfgFile), JSON.stringify(cfg, null, 2), "utf8");
  log("  " + cfgFile + " 已写入");

  log("\n\x1b[1m部署完成\x1b[0m\n");
  log("  AgentToken  " + cfg.token);
  log("  MinerNFT    " + cfg.nft);
  log("  CityCore    " + cfg.core);
  log("  多签国库     " + cfg.treasury);
  log("  注册表       " + cfg.registry);
  log("  矿机数       0  （未铸任何种子）");
  log("");
  log("  下一步：");
  log("    1. BscScan 验证源码（CityCore / MinerNFT / AgentToken / FrenzoMultiSig）");
  log("    2. 用你自己的 Agent 钱包从网站铸第一台（此时 mintOpen 还是关的）");
  log("    3. 准备好后执行：node scripts/open-mint.js");
  log("    4. 切换前端：node scripts/switch-network.js --live");
  log("");
  log("  余额 " + ethers.formatEther(await p.getBalance(w.address)) + " BNB");
})().catch((e) => {
  console.error("\n失败: " + (e.shortMessage || e.message));
  if (e.transaction) console.error("  交易: " + JSON.stringify(e.transaction).slice(0, 200));
  process.exit(1);
});
