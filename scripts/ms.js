#!/usr/bin/env node
/**
 * FRENZO 国库多签操作工具（仅适用于「有可导出私钥」的钱包）
 *
 * ⚠️ 如果你的 owner 是币安 MPC 钱包 / 无私钥钱包，这个脚本用不了。
 *    请改用网页版：https://frenzo.tech/ms/
 *    在币安 App → 钱包 → DApp 浏览器里打开，连接后点「确认」即可。
 *
 * 用法（PK 是你三个 owner 之一对应的私钥）：
 *   PK=0x... node scripts/ms.js status
 *   PK=0x... node scripts/ms.js submit <收款地址> <金额BNB>
 *   PK=0x... node scripts/ms.js confirm <txId>
 *   PK=0x... node scripts/ms.js revoke <txId>
 *   PK=0x... node scripts/ms.js execute <txId>
 *   PK=0x... node scripts/ms.js replace-owner <旧地址> <新地址>
 *   PK=0x... node scripts/ms.js change-required <数量>
 *   PK=0x... node scripts/ms.js list
 */

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const cfg = require("../deployment-97.json");

const RPC = process.env.RPC || "https://bsc-testnet-rpc.publicnode.com";
const MS = process.env.MS || cfg.multisig;
const PK = process.env.PK;

const ABI = require("../artifacts/FrenzoMultiSig.json").abi;
const G = { gasLimit: 900000, gasPrice: ethers.parseUnits("0.1", "gwei") };

(async () => {
  const p = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  const ms = new ethers.Contract(MS, ABI, p);
  const cmd = process.argv[2] || "status";

  // ── status / list 不需要私钥 ──
  if (cmd === "status" || cmd === "list") {
    const info = await ms.info();
    const owners = info[0];
    const required = info[1];
    const balance = info[3];
    const txNum = info[4];

    console.log("多签地址  " + MS);
    console.log("余额      " + ethers.formatEther(balance) + " BNB");
    console.log("规则      " + required + "-of-" + owners.length);
    console.log("交易总数  " + txNum);
    console.log("\nOwner:");
    for (let i = 0; i < owners.length; i++) console.log("  " + (i + 1) + ". " + owners[i]);

    if (cmd === "list" && txNum > 0n) {
      console.log("\n待执行交易:");
      let pending = 0;
      for (let id = 0; id < Number(txNum); id++) {
        const t = await ms.txs(id);
        if (t[3]) continue;   // 已执行跳过
        const confs = await ms.getConfirmations(id);
        console.log("  #" + id + " → " + t[0] + "  " + ethers.formatEther(t[1]) + " BNB  [" + confs.length + "/" + required + "]");
        pending++;
      }
      if (!pending) console.log("  （无）");
    }
    return;
  }

  // ── 以下都需要私钥 ──
  if (!PK) { console.error("请用 PK=0x... 指定 private key"); process.exit(1); }

  const w = new ethers.Wallet(PK, p);
  const c = new ethers.Contract(MS, ABI, w);
  const isOwner = await c.isOwner(w.address);
  console.log("操作账户  " + w.address + (isOwner ? "  (owner ✓)" : "  (不是 owner ✗)"));

  if (cmd === "submit") {
    const to = process.argv[3];
    const amount = process.argv[4];
    if (!to || !amount) { console.error("用法: submit <收款地址> <金额BNB>"); process.exit(1); }
    if (!isOwner) { console.error("只有 owner 能提交"); process.exit(1); }

    const value = ethers.parseEther(amount);
    const bal = await c.getBalance();
    if (value > bal) { console.error("金额超过多签余额 " + ethers.formatEther(bal)); process.exit(1); }

    const tx = await c.submit(ethers.getAddress(to), value, "0x", G);
    const rc = await tx.wait();
    const txId = (await c.txCount()) - 1n;
    console.log("已提交 #" + txId + "  gas " + rc.gasUsed);
    console.log("还需要 " + ((await c.required()) - 1n) + " 个 owner 确认：node scripts/ms.js confirm " + txId);
  }

  if (cmd === "confirm") {
    const id = BigInt(process.argv[3]);
    await (await c.confirm(id, G)).wait();
    const confs = await c.getConfirmations(id);
    const need = await c.required();
    console.log("#" + id + " 确认数 " + confs.length + "/" + need);
    if (BigInt(confs.length) >= need) console.log("票数已够，可执行：node scripts/ms.js execute " + id);
  }

  if (cmd === "revoke") {
    const id = BigInt(process.argv[3]);
    await (await c.revoke(id, G)).wait();
    console.log("#" + id + " 已撤销自己的确认");
  }

  if (cmd === "execute") {
    const id = BigInt(process.argv[3]);
    await (await c.execute(id, G)).wait();
    console.log("#" + id + " 已执行");
    console.log("多签余额 " + ethers.formatEther(await c.getBalance()) + " BNB");
  }

  if (cmd === "replace-owner") {
    const oldO = process.argv[3];
    const newO = process.argv[4];
    if (!oldO || !newO) { console.error("用法: replace-owner <旧地址> <新地址>"); process.exit(1); }
    if (!isOwner) { console.error("只有 owner 能提交"); process.exit(1); }
    const data = c.interface.encodeFunctionData("replaceOwner", [ethers.getAddress(oldO), ethers.getAddress(newO)]);
    await (await c.submit(MS, 0, data, G)).wait();
    const txId = (await c.txCount()) - 1n;
    console.log("已提交 owner 替换 #" + txId);
    console.log("还需要 1 个 owner 确认：node scripts/ms.js confirm " + txId);
  }

  if (cmd === "change-required") {
    const r = BigInt(process.argv[3]);
    if (!isOwner) { console.error("只有 owner 能提交"); process.exit(1); }
    const data = c.interface.encodeFunctionData("changeRequired", [r]);
    await (await c.submit(MS, 0, data, G)).wait();
    const txId = (await c.txCount()) - 1n;
    console.log("已提交阈值修改 #" + txId + " → " + r);
    console.log("还需要 1 个 owner 确认：node scripts/ms.js confirm " + txId);
  }
})().catch((e) => console.error("失败: " + (e.shortMessage || e.message)));
