const fs = require("fs");
const path = require("path");
const solc = require("solc");
const https = require("https");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..");
const NM = path.join(ROOT, "node_modules");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "deployment-56.json"), "utf8"));
const input = JSON.parse(fs.readFileSync(path.join(ROOT, "verify/standard-json-input.json"), "utf8"));

const findImports = (p) => {
  const full = path.join(NM, p);
  return fs.existsSync(full) ? { contents: fs.readFileSync(full, "utf8") } : { error: "nf" };
};
const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

// immutable 会被烘焙进 runtime，比对时把这些槽位掩掉
function maskImmutable(local, chain) {
  if (local.length !== chain.length) return { same: false, masked: 0 };
  let masked = 0;
  const a = local.split("");
  for (let i = 0; i < local.length; i += 2) {
    const l = local.slice(i, i + 2), c = chain.slice(i, i + 2);
    if (l !== c) {
      // 只有本地是全零、链上是实值时，判定为 immutable 槽位
      if (l === "00") { a[i] = c[0]; a[i + 1] = c[1]; masked++; }
    }
  }
  return { same: a.join("") === chain, masked };
}

const ARGS = {
  CityCore: "0x" + ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address", "address"],
    [cfg.token, cfg.nft, cfg.registry, cfg.multisig]
  ).slice(2),
  MinerNFT: "0x",
  AgentToken: "0x",
  FrenzoMultiSig: "0x" + ethers.AbiCoder.defaultAbiCoder().encode(
    ["address[]", "uint256"],
    [[
      "0xA322C480C9807e452f0F05C8071a433BfD9bfFcc",
      "0x150CE419A354C22e8fc88295CF49163B3c880685",
      "0xebFb760700b6E4A7DafBbb5faCD8A68bA78ff925",
    ], 2]
  ).slice(2),
};

const TARGETS = [
  ["contracts/CityCore.sol", "CityCore", cfg.core],
  ["contracts/MinerNFT.sol", "MinerNFT", cfg.nft],
  ["contracts/AgentToken.sol", "AgentToken", cfg.token],
  ["contracts/FrenzoMultiSig.sol", "FrenzoMultiSig", cfg.multisig],
];

function post(host, pathname, body) {
  return new Promise((res) => {
    const req = https.request({
      hostname: host, path: pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 120000,
    }, (r) => {
      let b = "";
      r.on("data", (d) => (b += d));
      r.on("end", () => res({ status: r.statusCode, body: b }));
    });
    req.on("error", (e) => res({ status: 0, body: e.message }));
    req.on("timeout", () => { req.destroy(); res({ status: 0, body: "timeout" }); });
    req.write(body);
    req.end();
  });
}

(async () => {
  const prov = new ethers.JsonRpcProvider(cfg.rpc, undefined, { staticNetwork: true });

  console.log("\x1b[1m字节码核对（掩掉 immutable 槽位）\x1b[0m");
  const good = [];
  for (const [file, name, addr] of TARGETS) {
    const c = out.contracts[file][name];
    const local = (c.evm.deployedBytecode.object || "").toLowerCase();
    const chain = (await prov.getCode(addr)).slice(2).toLowerCase();
    const r = maskImmutable(local, chain);
    console.log("  " + (r.same ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m") + " " + name.padEnd(15) +
      addr + "   immutable 槽 " + String(r.masked).padStart(3) + " 字节");
    if (r.same) good.push({ file, name, addr });
  }

  console.log("\n\x1b[1m提交 Sourcify（v2 API）\x1b[0m");
  const files = Object.fromEntries(Object.entries(input.sources).map(([k, v]) => [k, v.content]));

  for (const g of good) {
    const body = JSON.stringify({
      stdJsonInput: {
        language: "Solidity",
        sources: input.sources,
        settings: {
          optimizer: input.settings.optimizer,
          viaIR: input.settings.viaIR,
          outputSelection: { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode"] } },
        },
      },
      compilerVersion: solc.version(),
      contractIdentifier: g.file + ":" + g.name,
    });

    const res = await post("sourcify.dev", "/server/v2/verify/56/" + g.addr, body);
    let show = res.body.replace(/\s+/g, " ").slice(0, 200);
    console.log("  " + g.name.padEnd(15) + "HTTP " + res.status + "  " + show);
    await new Promise((r) => setTimeout(r, 1500));
  }

  // 保存 BscScan 手动验证所需的文件
  const dir = path.join(ROOT, "verify");
  for (const [file, name] of TARGETS.map((t) => [t[0], t[1]])) {
    fs.writeFileSync(path.join(dir, name + ".constructor-args.txt"), ARGS[name], "utf8");
  }
  console.log("\n构造参数已保存到 verify/*.constructor-args.txt");
  console.log("BscScan 手动验证：Contract → Verify and Publish → Solidity (Standard-Json-Input)");
  console.log("  上传 verify/standard-json-input.json，编译器 0.8.38，优化 200，viaIR 开");
})();
