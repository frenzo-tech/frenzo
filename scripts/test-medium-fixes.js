/**
 * Medium 修复回归：M-03 空池、M-04 群组、M-07 元数据域名
 */
const { ethers } = require("ethers");
const ganache = require("ganache");
const coreArt = require("../artifacts/CityCore.json");
const tokenArt = require("../artifacts/AgentToken.json");
const nftArt = require("../artifacts/MinerNFT.json");
const regArt = require("../artifacts/MockRegistry.json");

let pass = 0, fail = 0;
const ok = (n, c, e = "") => {
  if (c) { pass++; console.log("  \x1b[32m✓\x1b[0m " + n + (e ? "  \x1b[90m" + e + "\x1b[0m" : "")); }
  else { fail++; console.log("  \x1b[31m✗\x1b[0m " + n + (e ? "  \x1b[90m" + e + "\x1b[0m" : "")); }
};
const sec = (t) => console.log("\n\x1b[36m━━ " + t + " ━━\x1b[0m");
const G = { gasLimit: 1500000 };

async function deployStack(s) {
  const dep = async (art, args = []) => {
    const c = await new ethers.ContractFactory(art.abi, art.bytecode, s[0]).deploy(...args);
    await c.waitForDeployment();
    return c;
  };
  const token = await dep(tokenArt);
  const nft = await dep(nftArt);
  const reg = await dep(regArt);
  const core = await dep(coreArt, [await token.getAddress(), await nft.getAddress(), await reg.getAddress(), await s[9].getAddress()]);
  await (await token.setMinter(await core.getAddress())).wait();
  await (await core.setMintOpen(true)).wait();
  await (await nft.setCore(await core.getAddress())).wait();
  return { token, nft, reg, core };
}

(async () => {
  const eip = ganache.provider({ logging: { quiet: true }, chain: { chainId: 56 }, wallet: { totalAccounts: 12, defaultBalance: 10000 } });
  const provider = new ethers.BrowserProvider(eip);
  const s = [];
  for (let i = 0; i < 12; i++) s.push(await provider.getSigner(i));

  // ══════════ M-03 ══════════
  sec("M-03 空池时产出不蒸发");
  {
    const { core } = await deployStack(s);
    const before = await core.totalMined();
    // 没有任何矿机 → 两个池都空
    await new Promise((r) => setTimeout(r, 1200));
    let threw = false;
    try { await (await core.accrue({ gasLimit: 1000000 })).wait(); } catch { threw = true; }
    const after = await core.totalMined();
    ok("空池 accrue 不 revert", !threw);
    ok("totalMined 不推进（奖励滚回）", after === before, before.toString() + " → " + after.toString());
  }

  // ══════════ M-04 ══════════
  sec("M-04 群主卖出矿机后群组仍可用");
  {
    const { core, nft, reg } = await deployStack(s);
    for (let i = 0; i < 4; i++) {
      await (await reg.connect(s[i + 1]).set("m" + i, await s[i + 1].getAddress(), G)).wait();
      await (await core.connect(s[i + 1]).mintMiner("m" + i, { value: ethers.parseEther("0.001"), ...G })).wait();
    }
    // 1 建群
    await (await core.connect(s[1]).createGroup("测试群", G)).wait();
    console.log("    [diag] 建群完成");
    const gid = await core.groupOf(await s[1].getAddress());
    ok("群组已创建", gid > 0n, "gid " + gid);

    // 2 与 1 成为好友
    const rc = await (await core.connect(s[2]).requestFriend(1, G)).wait();
    let rid;
    for (const lg of rc.logs) { try { const pl = core.interface.parseLog(lg); if (pl && pl.name === "FriendRequested") rid = pl.args[0]; } catch {} }
    await (await core.connect(s[1]).acceptFriend(rid, G)).wait();
    console.log("    [diag] 好友建立完成");

    // 1 把矿机卖给 s[4]
    await (await nft.connect(s[1]).approve(await core.getAddress(), 1)).wait();
    await (await core.connect(s[1]).listMiner(1, ethers.parseEther("0.01"), G)).wait();
    await (await core.connect(s[5]).buyMiner(1, { value: ethers.parseEther("0.01"), ...G })).wait();
    ok("群主已卖出矿机", (await core.minerOf(await s[1].getAddress())) === 0n);

    // 2 仍能加群（用创建时的矿机编号校验）
    let joined = false;
    try { await (await core.connect(s[2]).joinGroup(gid, G)).wait(); joined = true; } catch (e) { console.log("    失败: " + (e.shortMessage || e.message).slice(0, 60)); }
    ok("卖出后好友仍能加入群组", joined);
    ok("成员数 = 2", (await core.groupMemberCount(gid)) === 2n);
  }

  // ══════════ M-07 ══════════
  sec("M-07 owner 可改 NFT 元数据域名");
  {
    const { core, nft } = await deployStack(s);
    // ganache 读 string 返回值有 bug，改用「调用成功 + 非 owner 被拒」验证
    let okOwner = false;
    try {
      await (await core.connect(s[0]).setNftBaseURI("https://new.example/p/", "https://new.example/v/?id=", G)).wait();
      okOwner = true;
    } catch (e) { console.log("    失败: " + (e.shortMessage || e.message).slice(0, 60)); }
    ok("owner 可调用 setNftBaseURI", okOwner);

    // 再改一次，证明确实可重复调用（不是一次性）
    let again = false;
    try {
      await (await core.connect(s[0]).setNftBaseURI("https://a/", "https://b/?id=", G)).wait();
      again = true;
    } catch (e) {}
    ok("可重复修改（不是一次性锁死）", again);

    let blocked = false;
    try { await (await core.connect(s[5]).setNftBaseURI("x", "y", G)).wait(); } catch { blocked = true; }
    ok("非 owner 被拒绝", blocked);
  }

  console.log("\n\x1b[1m结果：" + pass + " 通过 / " + fail + " 失败\x1b[0m");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.shortMessage || e.message); process.exit(1); });
