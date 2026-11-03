// 编译 + 静态检查脚本
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const ROOT = path.resolve(__dirname, "..");
const CONTRACTS = path.join(ROOT, "contracts");
const NM = path.join(ROOT, "node_modules");

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (f.endsWith(".sol")) out.push(p);
  }
  return out;
}

const sources = {};
for (const f of walk(CONTRACTS)) {
  sources[path.relative(ROOT, f).replace(/\\/g, "/")] = { content: fs.readFileSync(f, "utf8") };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] },
    },
  },
};

function findImports(p) {
  const candidates = [
    path.join(NM, p),
    path.join(ROOT, p),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return { contents: fs.readFileSync(c, "utf8") };
  }
  return { error: "File not found: " + p };
}

const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

let failed = false;

if (out.errors) {
  for (const e of out.errors) {
    const where = e.formattedMessage.split("\n")[0];
    if (e.severity === "error") {
      failed = true;
      console.error("[ERROR]", where);
      console.error(e.formattedMessage);
    } else {
      console.warn("[warn ]", where);
    }
  }
}

if (!failed) {
  const artifacts = path.join(ROOT, "artifacts");
  fs.mkdirSync(artifacts, { recursive: true });
  console.log("\n=== 编译成功 ===\n");
  for (const file of Object.keys(out.contracts || {})) {
    for (const name of Object.keys(out.contracts[file])) {
      const c = out.contracts[file][name];
      if (!c.evm.bytecode.object) continue;
      const size = c.evm.bytecode.object.length / 2;
      fs.writeFileSync(
        path.join(artifacts, name + ".json"),
        JSON.stringify({ abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2)
      );
      console.log(`  ${name.padEnd(18)} ${String(size).padStart(6)} bytes    ${file}`);
    }
  }
  console.log("\nartifacts/ 已生成");
}

process.exit(failed ? 1 : 0);
