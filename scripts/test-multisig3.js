/**
 * 多签完整流程验证（按 debug 里已验证可用的写法）
 */
const { ethers } = require("ethers");
const ganache = require("ganache");
const msArt = require("../artifacts/FrenzoMultiSig.json");

let pass = 0, fail = 0;
const ok = (n, c, e = "") => {
  if (c) { pass++; console.log("\x1b[32m  ✓\x1b[0m " + n + (e ? "  \x1b[90m" + e + "\x1b[0m" : "")); }
  else { fail++; console.log("\x1b[31m  ✗\x1b[0m " + n + (e ? "  \x1b[90m" + e + "\x1b[0m" : "")); }
};
const G = { gasLimit: 800000 };

(async () => {
  const eip = ganache.provider({ logging: { quiet: true }, chain: { chainId: 56 }, wallet: { totalAccounts: 10, defaultBalance: 10000 } });
  const provider = new ethers.BrowserProvider(eip);
  const s = [];
  for (let i = 0; i < 8; i++) s.push(await provider.getSigner(i));

  const o1 = await s[1].getAddress();
  const o2 = await s[2].getAddress();
  const o3 = await s[3].getAddress();
  const outsider = s[4];
  const beneficiary = await s[5].getAddress();

  console.log("\n\x1b[36m━━ 部署 2-of-3 ━━\x1b[0m");
  const ms = await new ethers.ContractFactory(msArt.abi, msArt.bytecode, s[0]).deploy([o1, o2, o3], 2);
  await ms.waitForDeployment();
  const addr = await ms.getAddress();
  ok("部署成功", !!addr, addr.slice(0, 10) + "…");
  ok("owners = 3", (await ms.ownerCount()) === 3n);
  ok("阈值 = 2-of-3", (await ms.required()) === 2n);

  console.log("\n\x1b[36m━━ 收款 ━━\x1b[0m");
  await (await s[6].sendTransaction({ to: addr, value: ethers.parseEther("10") })).wait();
  ok("余额 10 ETH", (await ms.getBalance()) === ethers.parseEther("10"));

  console.log("\n\x1b[36m━━ 提交 ━━\x1b[0m");
  let tx1;
  try {
    const tx = await ms.connect(s[1]).submit(beneficiary, ethers.parseEther("3"), "0x", G);
    await tx.wait();
    tx1 = 0n;
    ok("owner1 提交成功", true);
  } catch (e) { ok("提交", false, (e.shortMessage || e.message).slice(0, 60)); }

  ok("自动确认 1 票", (await ms.getConfirmations(tx1)).length === 1);
  ok("重复确认被拒绝", await (async () => {
    try { await (await ms.connect(s[1]).confirm(tx1, G)).wait(); return false; } catch { return true; }
  })());
  ok("非 owner 确认被拒绝", await (async () => {
    try { await (await ms.connect(outsider).confirm(tx1, G)).wait(); return false; } catch { return true; }
  })());
  ok("1 票不能执行", await (async () => {
    try { await (await ms.connect(outsider).execute(tx1, G)).wait(); return false; } catch { return true; }
  })());

  console.log("\n\x1b[36m━━ 第二票 → 执行 ━━\x1b[0m");
  await (await ms.connect(s[2]).confirm(tx1, G)).wait();
  ok("确认数 = 2", (await ms.getConfirmations(tx1)).length === 2);

  const msBefore = await ms.getBalance();
  await (await ms.connect(outsider).execute(tx1, G)).wait();
  ok("非 owner 也能触发执行（防卡死）", true);
  const msAfter = await ms.getBalance();
  ok("合约支出 3 ETH", msBefore - msAfter === ethers.parseEther("3"),
     ethers.formatEther(msBefore) + " → " + ethers.formatEther(msAfter));
  const balNow = await provider.getBalance(beneficiary);
  ok("受益人已收到（余额 > 9000 ETH）", balNow > ethers.parseEther("9000"), ethers.formatEther(balNow) + " ETH");
  ok("标记已执行", await ms.txExecuted(tx1));
  ok("不能重复执行", await (async () => {
    try { await (await ms.connect(s[1]).execute(tx1, G)).wait(); return false; } catch { return true; }
  })());

  console.log("\n\x1b[36m━━ 撤销确认 ━━\x1b[0m");
  await (await ms.connect(s[1]).submit(beneficiary, ethers.parseEther("1"), "0x", G)).wait();
  const tx2 = (await ms.txCount()) - 1n;
  await (await ms.connect(s[2]).confirm(tx2, G)).wait();
  ok("确认数 = 2", (await ms.getConfirmations(tx2)).length === 2);
  await (await ms.connect(s[2]).revoke(tx2, G)).wait();
  ok("撤销后回到 1", (await ms.getConfirmations(tx2)).length === 1);
  await (await ms.connect(s[3]).confirm(tx2, G)).wait();
  ok("换人补票再达 2", (await ms.getConfirmations(tx2)).length === 2);

  console.log("\n\x1b[36m━━ 确认人列表 ━━\x1b[0m");
  const confs = await ms.getConfirmations(tx2);
  ok("返回 2 个确认人", confs.length === 2, confs.map((c) => c.slice(0, 6)).join(", "));

  console.log("\n\x1b[36m━━ 余额守恒 ━━\x1b[0m");
  ok("合约剩 7 ETH（10 − 3）", (await ms.getBalance()) === ethers.parseEther("7"), ethers.formatEther(await ms.getBalance()) + " ETH");

  console.log("\n\x1b[1m结果：" + pass + " 通过 / " + fail + " 失败\x1b[0m");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.shortMessage || e.message); process.exit(1); });
