#!/usr/bin/env node
/**
 * FRENZO Agent CLI —— 给 AI Agent 调用的命令行接口
 *
 * 每个 Agent 的私钥应来自它自己的币安 MPC 钱包。
 *
 * 用法：
 *   PRIVATE_KEY=0x... node scripts/agent-cli.js status
 *   PRIVATE_KEY=0x... node scripts/agent-cli.js mint <handle>
 *   PRIVATE_KEY=0x... node scripts/agent-cli.js profile [矿机号]
 *   PRIVATE_KEY=0x... node scripts/agent-cli.js friend-request <对方矿机号>
 *   PRIVATE_KEY=0x... node scripts/agent-cli.js friend-accept <请求号>
 *   PRIVATE_KEY=0x... node scripts/agent-cli.js friend-remove <对方矿机号>
 *   PRIVATE_KEY=0x... node scripts/agent-cli.js group-create <名称>
 *   PRIVATE_KEY=0x... node scripts/agent-cli.js group-join <群组号>
 *   PRIVATE_KEY=0x... node scripts/agent-cli.js buy <矿机号> <份数>
 *   PRIVATE_KEY=0x... node scripts/agent-cli.js sell <矿机号> <份数>
 *   PRIVATE_KEY=0x... node scripts/agent-cli.js claim <矿机号>
 *   PRIVATE_KEY=0x... node scripts/agent-cli.js quote <矿机号> <份数> [buy|sell]
 *
 * 所有命令输出 JSON，方便 Agent 解析。
 */

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "deployment-97.json"), "utf8"));
const RPC = process.env.RPC || "https://bsc-testnet-rpc.publicnode.com";
const GAS = {
  gasLimit: 900000,
  gasPrice: ethers.parseUnits(process.env.GAS_PRICE_GWEI || "1", "gwei"),
};

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(obj.ok === false ? 1 : 0);
};

(async () => {
  const cmd = process.argv[2];
  if (!cmd) {
    out({
      ok: false,
      error: "缺少命令",
      commands: ["status", "mint", "profile", "friend-request", "friend-accept",
                 "friend-remove", "group-create", "group-join", "buy", "sell", "claim", "quote"],
    });
  }

  const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  const core = new ethers.Contract(cfg.core, require("../artifacts/CityCore.json").abi, provider);
  const nft = new ethers.Contract(cfg.nft, require("../artifacts/MinerNFT.json").abi, provider);
  const token = new ethers.Contract(cfg.token, require("../artifacts/AgentToken.json").abi, provider);

  // ── 只读命令不需要私钥 ──
  if (cmd === "quote") {
    const id = BigInt(process.argv[3]);
    const amount = BigInt(process.argv[4] || "1");
    const side = process.argv[5] || "buy";
    const info = await core.minerInfo(id);
    const supply = BigInt(info[2]);
    const cost = side === "buy"
      ? await core.costToBuy(supply, supply + amount)
      : await core.costToBuy(supply - amount > 0n ? supply - amount : 0n, supply);
    const fee = (cost * 1000n) / 10000n;
    out({
      ok: true, side, minerId: Number(id), amount: Number(amount),
      supply: Number(supply),
      cost: ethers.formatEther(cost),
      fee: ethers.formatEther(fee),
      total: ethers.formatEther(side === "buy" ? cost + fee : cost - fee),
      unit: "BNB",
    });
  }

  const pk = process.env.PRIVATE_KEY;
  if (!pk) out({ ok: false, error: "缺少 PRIVATE_KEY 环境变量" });

  const wallet = new ethers.Wallet(pk, provider);
  const me = wallet.address;
  const coreAsMe = core.connect(wallet);

  const minerId = Number(await core.minerOf(me));
  const handle = minerId ? await nft.handleOf(minerId) : "";
  const balance = await provider.getBalance(me);
  const frnz = await token.balanceOf(me);

  const base = {
    address: me, minerId, handle: handle ? handle + ".ai" : null,
    bnb: ethers.formatEther(balance),
    frnz: ethers.formatEther(frnz),
    chainId: cfg.chainId,
  };

  if (cmd === "status") {
    const count = Number(await core.minerCount());
    const price = await core.mintPrice();
    out({
      ok: true, ...base,
      network: { core: cfg.core, nft: cfg.nft, token: cfg.token, treasury: cfg.treasury, multisig: cfg.multisig },
      stats: {
        miners: count,
        mintPrice: ethers.formatEther(price),
        totalSupply: ethers.formatEther(await token.totalSupply()),
        totalMined: ethers.formatEther(await core.totalMined()),
      },
      hint: minerId ? null : "还没有矿机，先运行 mint <handle>",
    });
  }

  if (cmd === "profile") {
    const id = Number(process.argv[3] || minerId);
    if (!id) out({ ok: false, error: "没有矿机，也没指定矿机号" });
    const info = await core.minerInfo(id);
    const owner = await nft.ownerOf(id);
    const shares = await core.shares(id, me);
    const pending = await core.pendingOf(id);
    const gid = await core.groupOf(me);
    const groupCount = Number(await core.groupCount());

    // 好友从事件重建（分块）
    const head = await provider.getBlockNumber();
    const friends = new Set();
    const CHUNK = 4000;
    for (let end = head; end > head - 40000 && end > 0; end -= CHUNK) {
      try {
        const evs = await core.queryFilter(core.filters.FriendAccepted(), Math.max(0, end - CHUNK), end);
        for (const e of evs) {
          const A = Number(e.args[0]), B = Number(e.args[1]);
          if (A === id) friends.add(B);
          if (B === id) friends.add(A);
        }
      } catch (e) {}
    }

    out({
      ok: true, ...base,
      miner: {
        id,
        owner,
        isOwner: owner.toLowerCase() === me.toLowerCase(),
        friends: Number(info[1]),
        friendList: [...friends],
        supply: Number(info[2]),
        keyPrice: ethers.formatEther(info[5]),
        power: Number(info[4]) / 100 + "%",
        myShares: Number(shares),
        myPending: ethers.formatEther(pending),
        ownerRatio: Number(await core.ownerRatio(info[2])) / 100 + "%",
      },
      group: gid ? { id: Number(gid), name: (await core.groups(gid))[0], members: Number(await core.groupMemberCount(gid)) } : null,
      totalGroups: groupCount,
    });
  }

  // ── 写操作 ──
  const send = async (promise, label) => {
    try {
      const tx = await promise;
      const rc = await tx.wait();
      return { ok: true, action: label, tx: tx.hash, gasUsed: Number(rc.gasUsed) };
    } catch (e) {
      return { ok: false, action: label, error: (e.shortMessage || e.message || "").slice(0, 200) };
    }
  };

  if (cmd === "mint") {
    const h = (process.argv[3] || "").trim().toLowerCase().replace(/\.ai$/, "");
    if (!h) out({ ok: false, error: "用法: mint <handle>" });
    if (minerId) out({ ok: false, error: "该地址已有矿机 #" + minerId });

    const price = await core.mintPrice();
    if (balance < price) out({ ok: false, error: "余额不足，需要 " + ethers.formatEther(price) + " BNB" });

    // 1) 在身份注册表登记 handle（测试网用 MockRegistry）
    const reg = new ethers.Contract(cfg.registry, require("../artifacts/MockRegistry.json").abi, wallet);
    const r1 = await send(reg.set(h, me, GAS), "register-handle");
    if (!r1.ok) out(r1);

    // 2) 铸造
    const r2 = await send(coreAsMe.mintMiner(h, { value: price, ...GAS }), "mintMiner");
    if (!r2.ok) out(r2);

    const newId = Number(await core.minerOf(me));
    out({ ok: true, action: "mint", minerId: newId, handle: h + ".ai", paid: ethers.formatEther(price), txs: [r1.tx, r2.tx] });
  }

  if (cmd === "friend-request") {
    const to = BigInt(process.argv[3]);
    if (!minerId) out({ ok: false, error: "自己没有矿机" });
    const r = await send(coreAsMe.requestFriend(to, GAS), "requestFriend");
    if (!r.ok) out(r);
    const reqId = (await core.nextReqId());
    out({ ok: true, ...r, requestId: Number(reqId), hint: "等对方 acceptFriend(" + reqId + ")" });
  }

  if (cmd === "friend-accept") {
    const reqId = BigInt(process.argv[3]);
    const r = await send(coreAsMe.acceptFriend(reqId, GAS), "acceptFriend");
    out(r);
  }

  if (cmd === "friend-remove") {
    const other = BigInt(process.argv[3]);
    const r = await send(coreAsMe.removeFriend(other, GAS), "removeFriend");
    out(r);
  }

  if (cmd === "group-create") {
    const name = (process.argv[3] || "").trim();
    if (!name || name.length > 32) out({ ok: false, error: "群组名 1-32 字符" });
    const r = await send(coreAsMe.createGroup(name, GAS), "createGroup");
    if (!r.ok) out(r);
    out({ ok: true, ...r, groupId: Number(await core.groupOf(me)) });
  }

  if (cmd === "group-join") {
    const gid = BigInt(process.argv[3]);
    const r = await send(coreAsMe.joinGroup(gid, GAS), "joinGroup");
    out(r);
  }

  if (cmd === "buy") {
    const id = BigInt(process.argv[3]);
    const amount = BigInt(process.argv[4] || "1");
    const info = await core.minerInfo(id);
    const supply = BigInt(info[2]);
    const cost = await core.costToBuy(supply, supply + amount);
    const fee = (cost * 1000n) / 10000n;
    const value = cost + fee + 1n;
    if (balance < value) out({ ok: false, error: "余额不足，需要 " + ethers.formatEther(value) + " BNB" });
    const r = await send(coreAsMe.buyShares(id, amount, { value, ...GAS }), "buyShares");
    out({ ...r, paid: ethers.formatEther(value), shares: Number(amount) });
  }

  if (cmd === "sell") {
    const id = BigInt(process.argv[3]);
    const amount = BigInt(process.argv[4] || "1");
    const r = await send(coreAsMe.sellShares(id, amount, GAS), "sellShares");
    out({ ...r, shares: Number(amount) });
  }

  if (cmd === "claim") {
    const id = BigInt(process.argv[3] || minerId);
    const r = await send(coreAsMe.claim(id, GAS), "claim");
    out({ ...r, frnzBalance: ethers.formatEther(await token.balanceOf(me)) });
  }

  out({ ok: false, error: "未知命令: " + cmd });
})().catch((e) => out({ ok: false, error: (e.shortMessage || e.message || "").slice(0, 300) }));
