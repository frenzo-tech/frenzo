/**
 * 多签 owner 轮换测试（丢钥匙场景）
 */
const { ethers } = require("ethers");
const ganache = require("ganache");
const msArt = require("../artifacts/FrenzoMultiSig.json");

let pass = 0, fail = 0;
const ok = (n, c, e = "") => {
  if (c) { pass++; console.log("\x1b[32m  ✓\x1b[0m " + n + (e ? "  \x1b[90m" + e + "\x1b[0m" : "")); }
  else { fail++; console.log("\x1b[31m  ✗\x1b[0m " + n + (e ? "  \x1b[90m" + e + "\x1b[0m" : "")); }
};
const sec = (t) => console.log("\n\x1b[36m━━ " + t + " ━━\x1b[0m");
const G = { gasLimit: 900000 };

(async () => {
  const eip = ganache.provider({ logging: { quiet: true }, chain: { chainId: 56 }, wallet: { totalAccounts: 12, defaultBalance: 10000 } });
  const provider = new ethers.BrowserProvider(eip);
  const s = [];
  for (let i = 0; i < 10; i++) s.push(await provider.getSigner(i));

  const o1 = await s[1].getAddress();
  const o2 = await s[2].getAddress();
  const o3 = await s[3].getAddress();
  const newOwner = await s[8].getAddress();

  const ms = await new ethers.ContractFactory(msArt.abi, msArt.bytecode, s[0]).deploy([o1, o2, o3], 2);
  await ms.waitForDeployment();
  const addr = await ms.getAddress();
  await (await s[6].sendTransaction({ to: addr, value: ethers.parseEther("5") })).wait();

  sec("初始状态");
  ok("3 个 owner", (await ms.ownerCount()) === 3n);
  ok("阈值 2", (await ms.required()) === 2n);
  ok("余额 5 ETH", (await ms.getBalance()) === ethers.parseEther("5"));

  sec("丢了一把钥匙 → 替换 owner");
  // owner1 丢了钥匙，剩下 o2/o3 两票即可替换
  const data = ms.interface.encodeFunctionData("replaceOwner", [o1, newOwner]);
  await (await ms.connect(s[2]).submit(addr, 0, data, G)).wait();
  const txId = (await ms.txCount()) - 1n;
  await (await ms.connect(s[3]).confirm(txId, G)).wait();
  await (await ms.connect(s[5]).execute(txId, G)).wait();

  ok("旧 owner 已移除", (await ms.isOwner(o1)) === false);
  ok("新 owner 已加入", (await ms.isOwner(newOwner)) === true);
  ok("仍是 3 个 owner", (await ms.ownerCount()) === 3n);
  ok("阈值不变（2）", (await ms.required()) === 2n);

  sec("新 owner 组合能继续提款");
  const before = await ms.getBalance();
  await (await ms.connect(s[8]).submit(o1, ethers.parseEther("2"), "0x", G)).wait();
  const tx2 = (await ms.txCount()) - 1n;
  await (await ms.connect(s[3]).confirm(tx2, G)).wait();
  await (await ms.connect(s[7]).execute(tx2, G)).wait();
  ok("成功提出 2 ETH", before - (await ms.getBalance()) === ethers.parseEther("2"), "剩 " + ethers.formatEther(await ms.getBalance()));

  sec("丢了两把钥匙前的最后防线：不能把 owner 减到低于阈值");
  const data2 = ms.interface.encodeFunctionData("removeOwner", [o3]);
  await (await ms.connect(s[2]).submit(addr, 0, data2, G)).wait();
  const tx3 = (await ms.txCount()) - 1n;
  await (await ms.connect(s[8]).confirm(tx3, G)).wait();
  let blocked = false;
  try { await (await ms.connect(s[5]).execute(tx3, G)).wait(); } catch { blocked = true; }
  ok("3→2 且阈值 2 时允许移除", !blocked);

  sec("再移除就到 1 人，必须被拦");
  const data3 = ms.interface.encodeFunctionData("removeOwner", [newOwner]);
  await (await ms.connect(s[2]).submit(addr, 0, data3, G)).wait();
  const tx4 = (await ms.txCount()) - 1n;
  await (await ms.connect(s[8]).confirm(tx4, G)).wait();
  let blocked2 = false;
  try { await (await ms.connect(s[5]).execute(tx4, G)).wait(); } catch { blocked2 = true; }
  ok("人数不足阈值时拒绝移除", blocked2);

  sec("直接调用管理函数被拒（必须走多签）");
  ok("addOwner 拒绝直接调用", await (async () => {
    try { await (await ms.connect(s[1]).addOwner(o1, G)).wait(); return false; } catch { return true; }
  })());
  ok("changeRequired 拒绝直接调用", await (async () => {
    try { await (await ms.connect(s[1]).changeRequired(1, G)).wait(); return false; } catch { return true; }
  })());

  sec("info() 一次性读");
  const i = await ms.info();
  ok("info 返回 owner 数", i[1] === 2n || i[1] === 2n, "阈值 " + i[1] + " / 人数 " + i[2]);

  console.log("\n\x1b[1m结果：" + pass + " 通过 / " + fail + " 失败\x1b[0m");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.shortMessage || e.message); process.exit(1); });
