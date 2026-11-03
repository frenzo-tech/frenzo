#!/usr/bin/env node
/* FRENZO 项目快照刷新器：每 5 分钟把链上状态写成 /api/project.json
 * 配置全部来自 /var/www/frenzo/deployment-local.json，不再硬编码网络
 */
const fs = require('fs');
const { ethers } = require('/opt/frenzo-render/node_modules/ethers');

const CFG_FILE = '/var/www/frenzo/deployment-local.json';
const ABI_DIR = '/opt/frenzo-render/abi/';
const OUT = '/var/www/frenzo/api/project.json';

const E = (x) => Number(ethers.formatEther(x));

// 候选 RPC（主网 / 测试网各一组，按 chainId 选）
const RPCS = {
  56: [
    'https://bsc-rpc.publicnode.com',
    'https://1rpc.io/bnb',
    'https://bsc-mainnet.public.blastapi.io',
  ],
  97: [
    'https://bsc-testnet-rpc.publicnode.com',
    'https://data-seed-prebsc-1-s1.binance.org:8545',
  ],
};

function safeHandle(h) {
  if (h == null) return '';
  let s = String(h);
  s = s.replace(/[\u0000-\u001f\u007f<>{}()\[\]`$\\]/g, '');
  s = s.replace(/[^0-9A-Za-z_\-\u4e00-\u9fff]/g, '');
  if (s.length > 24) s = s.slice(0, 24);
  if (!s) s = 'unnamed';
  return s;
}

function loadCfg() {
  const c = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
  for (const k of ['core', 'nft', 'token', 'chainId']) {
    if (!c[k]) throw new Error('配置缺少 ' + k);
  }
  return c;
}

async function pickProvider(chainId, preferred) {
  const list = [];
  if (preferred && /^https?:\/\//.test(preferred)) list.push(preferred);
  RPCS[chainId].forEach((r) => { if (!list.includes(r)) list.push(r); });

  for (const url of list) {
    try {
      const p = new ethers.JsonRpcProvider(url, chainId, { staticNetwork: true });
      const net = await p.getNetwork();
      if (Number(net.chainId) !== chainId) { console.error('  ' + url + ' 链不对'); continue; }
      const code = await p.getCode(CODEFOR);
      if (!code || code === '0x') { console.error('  ' + url + ' 上没合约'); continue; }
      return { p, url };
    } catch (e) {
      console.error('  ' + url + ' 不可用: ' + e.message.slice(0, 50));
    }
  }
  throw new Error('所有 RPC 都不可用');
}

let CODEFOR = null;

(async () => {
  const cfg = loadCfg();
  const chainId = Number(cfg.chainId);
  CODEFOR = cfg.core;

  let provider = null, rpcUsed = null;
  for (const url of [cfg.rpcUpstream, cfg.rpc].filter((x) => x && /^https?:\/\//.test(x))
    .concat(RPCS[chainId] || [])) {
    if (provider) break;
    try {
      const p = new ethers.JsonRpcProvider(url, chainId, { staticNetwork: true });
      const net = await p.getNetwork();
      if (Number(net.chainId) !== chainId) continue;
      const code = await p.getCode(cfg.core);
      if (!code || code === '0x') continue;
      provider = p; rpcUsed = url;
    } catch (e) {}
  }
  if (!provider) throw new Error('找不到可用的 ' + chainId + ' RPC');

  const core = new ethers.Contract(cfg.core, require(ABI_DIR + 'CityCore.json').abi, provider);
  const nft = new ethers.Contract(cfg.nft, require(ABI_DIR + 'MinerNFT.json').abi, provider);

  const n = Number(await core.minerCount());
  const daily = E(await core.REWARD_PER_SEC()) * 86400;
  const keyValue = E(await core.totalKeyValue());
  const units = Number(await core.totalFriendUnits());

  // 批量取矿机，失败则逐台取
  let rows = [];
  if (n > 0) {
    let ok = false;
    try {
      const b = await core.minersBatch(1, n);
      let hs = [];
      try { hs = await nft.handlesBatch(1, n); } catch (e) {}
      for (let i = 0; i < b.ids.length; i++) {
        let own = '';
        try { own = await nft.ownerOf(Number(b.ids[i])); } catch (e) {}
        rows.push({
          id: Number(b.ids[i]),
          raw: hs[i] || '',
          owner: own,
          friends: Number(b.friends[i]),
          keys: Number(b.supplies[i]),
          power: Number(b.powers[i]),
          price: b.prices[i],
        });
      }
      ok = rows.length === n;
    } catch (e) {
      rows = [];
    }

    if (!ok) {
      rows = [];
      for (let id = 1; id <= n; id++) {
        try {
          const info = await core.minerInfo(id);
          let h = '', own = '';
          try { h = await nft.handleOf(id); } catch (e) {}
          try { own = await nft.ownerOf(id); } catch (e) {}
          rows.push({
            id,
            raw: h,
            owner: own,
            friends: Number(info[1]),
            keys: Number(info[2]),
            power: Number(info[4]),
            price: info[5],
          });
        } catch (e) {}
      }
    }
  }

  let flagged = 0;
  const miners = rows.map((r) => {
    const clean = safeHandle(r.raw);
    if (clean !== r.raw) flagged++;
    const power = r.power / 100;
    return {
      id: r.id,
      handle: clean + '.ai',
      owner: r.owner || '',
      friends: r.friends,
      keys: r.keys,
      powerPct: +power.toFixed(2),
      keyPriceBnb: E(r.price),
      estDailyFrnz: Math.round(daily * power / 100),
    };
  });
  miners.sort((a, b) => b.powerPct - a.powerPct);

  const snap = {
    schema: 'frenzo.project.v1',
    generatedAt: new Date().toISOString(),
    network: { chainId, rpc: rpcUsed },
    contracts: { core: cfg.core, nft: cfg.nft, token: cfg.token },
    token: {
      symbol: 'FRNZ',
      maxSupply: E(await core.MAX_SUPPLY()),
      totalMined: +E(await core.totalMined()).toFixed(2),
      emissionPerDay: Math.round(daily),
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
      freeFriends: Number(await core.FRIEND_FREE()),
      friendFeeFrnz: E(await core.FRIEND_COST()),
    },
    governance: {
      owner: await core.owner(),
      renounced: (await core.owner()) === ethers.ZeroAddress,
      treasury: await core.treasury(),
    },
    integrity: {
      note: 'handle 已净化（仅字母数字/_/-/CJK，上限 24 字符），防止链上字符串向消费方注入指令',
      sanitizedHandles: flagged,
    },
    miners,
  };

  fs.writeFileSync(OUT + '.tmp', JSON.stringify(snap, null, 2));
  fs.renameSync(OUT + '.tmp', OUT);
  console.log('已刷新 chainId=' + chainId + ' 矿机=' + n + ' rpc=' + rpcUsed);
})().catch((e) => {
  console.error('刷新失败: ' + e.message);
  process.exit(1);
});
