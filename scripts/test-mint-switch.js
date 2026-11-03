/**
 * 铸造开关回归：部署即关闭，必须显式开卖
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

(async () => {
  const eip = ganache.provider({ logging: { quiet: true }, chain: { chainId: 56 }, wallet: { totalAccounts: 8, defaultBalance: 10000 } });
  const provider = new ethers.BrowserProvider(eip);
  const s = [];
  for (let i = 0; i < 8; i++) s.push(await provider.getSigner(i));

  const dep = async (art, args = []) => {
    const c = await new ethers.ContractFactory(art.abi, art.bytecode, s[0]).deploy(...args);
    await c.waitForDeployment();
    return c;
  };
  const token = await dep(tokenArt);
  const nft = await dep(nftArt);
  const reg = await dep(regArt);
  const core = await dep(coreArt, [await token.getAddress(), await nft.getAddress(), await reg.getAddress(), await s[7].getAddress()]);
  await (await token.setMinter(await core.getAddress())).wait();
  await (await nft.setCore(await core.getAddress())).wait();

  const mint = async (signer, handle) => {
    try {
      await (await reg.connect(signer).set(handle, await signer.getAddress(), G)).wait();
      await (await core.connect(signer).mintMiner(handle, { value: ethers.parseEther("0.001"), ...G })).wait();
      return "ok";
    } catch (e) { return (e.shortMessage || e.message || "").slice(0, 40); }
  };

  sec("默认状态");
  ok("部署后 mintOpen = false", (await core.mintOpen()) === false);

  const r1 = await mint(s[1], "alice");
  ok("关闭状态下铸造被拒", r1 !== "ok", r1);
  ok("矿机数仍为 0", (await core.minerCount()) === 0n);

  sec("权限");
  let blocked = false;
  try { await (await core.connect(s[2]).setMintOpen(true, G)).wait(); } catch { blocked = true; }
  ok("非 owner 无法开卖", blocked);
  ok("mintOpen 仍为 false", (await core.mintOpen()) === false);

  sec("owner 开卖");
  await (await core.connect(s[0]).setMintOpen(true, G)).wait();
  ok("开卖后 mintOpen = true", (await core.mintOpen()) === true);

  const r2 = await mint(s[1], "alice");
  ok("开卖后可以铸造", r2 === "ok", r2);
  ok("矿机数 = 1", (await core.minerCount()) === 1n);

  sec("再次关闭");
  await (await core.connect(s[0]).setMintOpen(false, G)).wait();
  const r3 = await mint(s[2], "bob");
  ok("关闭后铸造又被拒", r3 !== "ok", r3);
  ok("矿机数仍为 1", (await core.minerCount()) === 1n);

  sec("renounce 保护");
  let renounceBlocked = false;
  try { await (await core.connect(s[0]).renounceOwnership(G)).wait(); } catch { renounceBlocked = true; }
  ok("关闭状态下禁止 renounce", renounceBlocked);
  ok("owner 未变", (await core.owner()).toLowerCase() === (await s[0].getAddress()).toLowerCase());

  await (await core.connect(s[0]).setMintOpen(true, G)).wait();
  let renounceOk = false;
  try { await (await core.connect(s[0]).renounceOwnership(G)).wait(); renounceOk = true; } catch {}
  ok("开卖状态下可以 renounce", renounceOk);
  ok("owner 已归零", (await core.owner()) === ethers.ZeroAddress);
  ok("renounce 后 mintOpen 保持 true", (await core.mintOpen()) === true);

  const r4 = await mint(s[3], "carol");
  ok("renounce 后仍可铸造", r4 === "ok", r4);

  console.log("\n\x1b[1m结果：" + pass + " 通过 / " + fail + " 失败\x1b[0m");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.shortMessage || e.message); process.exit(1); });
