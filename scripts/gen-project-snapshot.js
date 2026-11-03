/**
 * 生成 AI 可直接读取的项目快照 /api/project.json
 * 任何 Agent 拉这一个 URL 就能做完整分析，不用自己算
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { Client } = require("ssh2");

const ROOT = path.join(__dirname, "..");
const cfg = require(path.join(ROOT, "deployment-97.json"));
const RPC = process.env.RPC || "https://bsc-testnet-rpc.publicnode.com";
const HOST = process.env.FZ_HOST || "45.153.130.144";
const PASS = process.env.FZ_PASS || "";
const E = (x) => Number(ethers.formatEther(x));

(async () => {
  const p = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  const core = new ethers.Contract(cfg.core, require(path.join(ROOT, "artifacts/CityCore.json")).abi, p);
  const nft = new ethers.Contract(cfg.nft, require(path.join(ROOT, "artifacts/MinerNFT.json")).abi, p);
  const token = new ethers.Contract(cfg.token, require(path.join(ROOT, "artifacts/AgentToken.json")).abi, p);

  const n = Number(await core.minerCount());
  const daily = E(await core.REWARD_PER_SEC()) * 86400;
  const keyValue = E(await core.totalKeyValue());
  const units = Number(await core.totalFriendUnits());
  const treasury = await core.treasury();

  const b = await core.minersBatch(1, n);
  const hs = await nft.handlesBatch(1, n);
  const miners = [];
  for (let i = 0; i < b.ids.length; i++) {
    const id = Number(b.ids[i]);
    const info = await core.minerInfo(id);
    const power = Number(b.powers[i]) / 100;
    miners.push({
      id,
      handle: hs[i] + ".ai",
      friends: Number(b.friends[i]),
      keys: Number(b.supplies[i]),
      powerPct: +power.toFixed(2),
      keyPriceBnb: E(b.prices[i]),
      estDailyFrnz: Math.round((daily * power) / 100),
      ownerSharePct: +(Number(await core.ownerRatio(info[2])) / 100).toFixed(1),
      pendingFrnz: +E(info[6]).toFixed(2),
    });
  }
  miners.sort((a, b2) => b2.powerPct - a.powerPct);

  // 曲线
  const curve = [];
  for (const s of [0, 1, 2, 3, 5, 10, 20, 50, 100, 200]) {
    const sB = BigInt(s);
    curve.push({
      supply: s,
      nextKeyBnb: +E(await core.sharePrice(sB)).toFixed(6),
    });
  }

  // 新用户模拟：铸造 + 10 个好友
  const newUnits = 11;
  const simFriendShare = newUnits / (units + newUnits);
  const myKeyVal = E(await core.costToBuy(0n, 2n));
  const simKeyShare = keyValue > 0 ? myKeyVal / (keyValue + myKeyVal) : 1;
  const simPower = (0.3 * simFriendShare + 0.7 * simKeyShare) * 100;

  const snapshot = {
    schema: "frenzo.project.v1",
    generatedAt: new Date().toISOString(),
    network: { chainId: cfg.chainId, rpc: RPC, explorer: "https://testnet.bscscan.com" },
    contracts: {
      core: cfg.core, nft: cfg.nft, token: cfg.token,
      registry: cfg.registry, treasury,
    },
    token: {
      symbol: "FRNZ",
      maxSupply: E(await core.MAX_SUPPLY()),
      totalMined: +E(await core.totalMined()).toFixed(2),
      circulating: +E(await token.totalSupply()).toFixed(2),
      emissionPerDay: Math.round(daily),
      emissionYears: 3,
      emittedPct: +(E(await core.totalMined()) / E(await core.MAX_SUPPLY()) * 100).toFixed(4),
      premine: false,
    },
    mining: {
      miners: n,
      totalFriendUnits: units,
      totalKeyValueBnb: +keyValue.toFixed(8),
      mintPriceBnb: E(await core.mintPrice()),
      mintGivesKeys: Number(await core.MINT_KEYS()),
      pools: { friends: 0.3, keys: 0.7 },
    },
    fees: {
      tradeBps: Number(await core.FEE_BPS()) / 100,
      creatorShareOfFeePct: Number(await core.CREATOR_FEE_BPS()) / 100,
      marketBps: Number(await core.MARKET_FEE_BPS()) / 100,
      freeFriends: Number(await core.FRIEND_FREE()),
      friendFeeFrnz: E(await core.FRIEND_COST()),
      friendFeeBurned: true,
    },
    curve: { type: "friend.tech", k: Number(await core.CURVE_K()), points: curve },
    governance: {
      owner: await core.owner(),
      renounced: (await core.owner()) === ethers.ZeroAddress,
      treasuryIsMultisig: treasury !== ethers.ZeroAddress,
    },
    liquidity: {
      hasDexPool: false,
      note: "主网尚未建池；FRNZ 无市场价格，UI 显示的产出一律按枚数计算",
    },
    miners,
    simulation: {
      scenario: "新用户铸造 1 台 + 加 10 个好友（免费额度内）",
      costBnb: +(E(await core.mintPrice())).toFixed(6),
      resultingPowerPct: +simPower.toFixed(2),
      estDailyFrnz: Math.round((daily * simPower) / 100),
      note: "权重随全网矿机数与好友数变化，这是按当前快照的一次性推算",
    },
    warnings: [
      "测试网数据，主网经济参数将以部署时为准",
      "FRNZ 目前没有 DEX 池，任何 FRNZ 金额都只是枚数，换算不成价格",
      "好友关系无女巫防护，同一人可用多钱包互加刷权重",
      "所有权尚未放弃，owner 仍可修改 treasury / registry / 元数据域名",
    ],
  };

  const out = path.join(ROOT, "api", "project.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(snapshot, null, 2), "utf8");
  console.log("已生成 project.json（" + (JSON.stringify(snapshot).length / 1024).toFixed(1) + " KB）");
  console.log("  矿机 " + n + " · 权重最高 " + miners[0].handle + " " + miners[0].powerPct + "%");
  console.log("  新用户模拟：" + snapshot.simulation.resultingPowerPct + "% → " + snapshot.simulation.estDailyFrnz + " FRNZ/天");

  // 上传
  const c = new Client();
  await new Promise((r, j) => { c.on("ready", r); c.on("error", j);
    c.connect({ host: HOST, port: 22, username: "root", password: PASS, readyTimeout: 25000 }); });
  const sftp = await new Promise((r, j) => c.sftp((e, s) => (e ? j(e) : r(s))));
  const run = (cmd) => new Promise((res) => {
    c.exec(cmd, (e, st) => { let o = ""; st.on("data", (d) => (o += d)); st.on("close", () => res(o.trim())); });
  });
  await run("mkdir -p /var/www/frenzo/api");
  await new Promise((r, j) => sftp.fastPut(out, "/var/www/frenzo/api/project.json", (e) => (e ? j(e) : r())));
  console.log("已上传 https://frenzo.tech/api/project.json");
  c.end();
})().catch((e) => console.error("FATAL", e.shortMessage || e.message));
