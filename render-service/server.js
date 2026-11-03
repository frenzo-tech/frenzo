/**
 * FRENZO 海报自动渲染服务
 *   · 监听区块事件 / 定时轮询，发现新矿机就渲染海报
 *   · nginx 请求缺失的海报时，回退到这里现场渲染
 */
const http = require("http");
const fs = require("fs");
const { execSync } = require("child_process");
const path = require("path");
const { ethers } = require("ethers");
const puppeteer = require("puppeteer-core");
const sharp = require("sharp");

const CFG = JSON.parse(fs.readFileSync("/var/www/frenzo/nft/chain.json", "utf8"));
const RPC = "https://bsc-testnet-rpc.publicnode.com";
const NFT_DIR = "/var/www/frenzo/nft";
const POSTER_DIR = path.join(NFT_DIR, "poster");
const THUMB_DIR = path.join(NFT_DIR, "thumb");
const PORT = 8700;
// 优先用独立 Chrome（chrome-for-testing），snap 版在 /tmp 被清后会废
const CHROME =
  process.env.CHROME_PATH ||
  ["/opt/chrome-headless-shell-linux64/chrome-headless-shell",
   "/usr/bin/chromium-browser",
   "/snap/bin/chromium",
   "/usr/bin/chromium"].find((p) => fs.existsSync(p)) || "/usr/bin/chromium";
const MIN_BYTES = 200 * 1024;
const GLOW = {
  Violet: "rgba(124,92,255,.38)", Teal: "rgba(30,200,180,.34)", Coral: "rgba(255,122,122,.32)",
  Amber: "rgba(255,171,46,.34)", Azure: "rgba(79,142,247,.34)", Orchid: "rgba(192,107,255,.34)",
};

fs.mkdirSync(POSTER_DIR, { recursive: true });
fs.mkdirSync(THUMB_DIR, { recursive: true });

const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
const nft = new ethers.Contract(CFG.nft, require("./abi/MinerNFT.json").abi, provider);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const busy = new Set();
const CONCURRENCY = 3;
let running = 0;

function hexToStr(hex) {
  hex = hex.replace(/^0x/, "");
  const len = parseInt(hex.slice(64, 128), 16);
  const body = hex.slice(128, 128 + len * 2);
  const bytes = Buffer.from(body, "hex");
  try { return decodeURIComponent(escape(bytes.toString("binary"))); }
  catch (e) { return bytes.toString("utf8"); }
}

async function traitsOf(id) {
  const uri = await nft.tokenURI(id);
  const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString("utf8"));
  const t = {};
  (json.attributes || []).forEach((a) => (t[a.trait_type] = a.value));
  return {
    handle: (json.name || "").replace(/\.ai.*$/, ""),
    gender: t.Gender || "Male", skin: t.Skin || "Light", hair: t.Hair || "Rose",
    outfit: t.Outfit || "Violet", acc: t.Accessory || "Visor",
  };
}

let browser = null;
async function getBrowser() {
  if (browser && browser.connected) return browser;
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
           "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--disable-gpu",
           "--host-resolver-rules=MAP frenzo.tech 127.0.0.1", "--ignore-certificate-errors"],
  });
  return browser;
}

const RENDER_TIMEOUT = 180000;   // 单张最多 3 分钟

async function render(id) {
  if (busy.has(id)) return false;
  busy.add(id);
  const t0 = Date.now();
  try {
    return await Promise.race([_render(id, t0), new Promise((_, rej) =>
      setTimeout(() => rej(new Error("渲染超时 180s")), RENDER_TIMEOUT))]);
  } catch (e) {
    log("#" + id + " 渲染失败: " + (e.message || e).slice(0, 80));
    // 超时后浏览器可能处于坏状态，强制重建
    try { if (browser) { await browser.close(); } } catch (err) {}
    browser = null;
    return false;
  } finally {
    busy.delete(id);
  }
}

async function _render(id, t0) {
  try {
    const tr = await traitsOf(id);
    const tex = tr.skin.toLowerCase() + "_" + tr.outfit.toLowerCase();
    const q = new URLSearchParams({
      id: String(id), h: tr.handle, g: tr.gender, sk: tr.skin, hr: tr.hair,
      of: tr.outfit, ac: tr.acc, tex, glow: GLOW[tr.outfit] || "rgba(124,92,255,.35)",
    });

    const b = await getBrowser();
    const page = await b.newPage();
    await page.setViewport({ width: 1024, height: 1024, deviceScaleFactor: 1 });
    await page.goto("https://frenzo.tech/viewer/poster.html?" + q.toString(), {
      waitUntil: "networkidle2", timeout: 60000,
    });
    await page.waitForFunction("window.__ready === true", { timeout: 45000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 600));
    const buf = await page.screenshot({ type: "png" });
    await page.close();

    if (buf.length < MIN_BYTES) throw new Error("渲染结果过小（模型可能未加载）");

    const png = path.join(POSTER_DIR, id + ".png");
    fs.writeFileSync(png, buf);

    await sharp(buf).webp({ quality: 90 }).toFile(path.join(POSTER_DIR, id + ".webp"));
    await sharp(buf).extract({ left: 300, top: 170, width: 440, height: 440 })
      .resize(256, 256).webp({ quality: 88 }).toFile(path.join(THUMB_DIR, id + ".webp"));

    log("#" + id + " " + tr.handle + " " + tex + " ✓ " + (buf.length / 1024).toFixed(0) + "KB " + (Date.now() - t0) + "ms");
    return true;
  } catch (e) {
    throw e;
  }
}

function exists(id) {
  const f = path.join(POSTER_DIR, id + ".png");
  return fs.existsSync(f) && fs.statSync(f).size >= MIN_BYTES;
}

// ── 定时补渲染 ──
let lastCount = 0;
async function poll() {
  try {
    const core = new ethers.Contract(CFG.core, require("./abi/CityCore.json").abi, provider);
    const n = Number(await core.minerCount());
    if (n !== lastCount) { log("矿机数量 " + lastCount + " → " + n); lastCount = n; }
    const missing = [];
    for (let id = 1; id <= n; id++) if (!exists(id)) missing.push(id);
    if (missing.length) log("待渲染 " + missing.length + " 张");
    for (let i = 0; i < missing.length; i += CONCURRENCY) {
      await Promise.all(missing.slice(i, i + CONCURRENCY).map((id) => render(id)));
    }
  } catch (e) {
    log("轮询失败: " + (e.message || e).slice(0, 60));
  }
}

// ── HTTP 服务：nginx 回退用 ──
// ── 3D 转盘录制：复用已启动的浏览器，避免 snap 多实例冲突 ──
const TT_DIR = "/var/www/frenzo/nft/video";
const ttBusy = new Set();

async function turntable(id, frames) {
  if (ttBusy.has(id)) return "busy";
  ttBusy.add(id);
  const dir = "/tmp/tt_" + id;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(TT_DIR, { recursive: true });

  let page;
  try {
    const tr = await traitsOf(id);
    const tex = tr.skin.toLowerCase() + "_" + tr.outfit.toLowerCase();
    const q = new URLSearchParams({
      id: String(id), h: tr.handle, g: tr.gender, sk: tr.skin, hr: tr.hair,
      of: tr.outfit, ac: tr.acc, tex, glow: GLOW[tr.outfit] || "rgba(124,92,255,.35)",
    });

    const b = await getBrowser();
    page = await b.newPage();
    await page.setViewport({ width: 900, height: 900, deviceScaleFactor: 1 });
    await page.goto("https://frenzo.tech/viewer/poster.html?" + q.toString(), {
      waitUntil: "networkidle2", timeout: 60000,
    });
    await page.waitForFunction("window.__ready === true && typeof window.__setRot === 'function'", { timeout: 45000 });
    await new Promise((r) => setTimeout(r, 800));

    for (let f = 0; f < frames; f++) {
      const rad = (f / frames) * Math.PI * 2;
      await page.evaluate((r) => window.__setRot && window.__setRot(r), rad);
      await new Promise((r) => setTimeout(r, 16));
      await page.screenshot({ path: dir + "/f" + String(f).padStart(4, "0") + ".png" });
    }

    const mp4 = TT_DIR + "/miner-" + id + ".mp4";
    const gif = TT_DIR + "/miner-" + id + ".gif";
    execSync(
      "ffmpeg -y -loglevel error -framerate 24 -i " + dir + "/f%04d.png " +
      "-vf scale=720:720:flags=lanczos -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart " + mp4
    );
    execSync(
      "ffmpeg -y -loglevel error -framerate 24 -i " + dir + "/f%04d.png " +
      "-vf 'scale=600:600:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse' " + gif
    );
    fs.rmSync(dir, { recursive: true, force: true });
    const kb = (f) => Math.round(fs.statSync(f).size / 1024);
    log("#" + id + " 转盘完成 mp4 " + kb(mp4) + "KB gif " + kb(gif) + "KB");
    return "ok mp4=" + kb(mp4) + "KB gif=" + kb(gif) + "KB";
  } catch (e) {
    return "err " + (e.message || e);
  } finally {
    if (page) await page.close().catch(() => {});
    ttBusy.delete(id);
  }
}

http.createServer(async (req, res) => {
  const tt = req.url.match(/^\/tt\/(\d+)(?:\?f=(\d+))?/);
  if (tt) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    const out = await turntable(Number(tt[1]), Number(tt[2] || 96));
    res.end(out);
    return;
  }

  const m = req.url.match(/^\/nft\/(poster|thumb)\/(\d+)\.(png|webp)$/);
  if (!m) { res.writeHead(404); return res.end("not found"); }

  const [, kind, idStr, ext] = m;
  const id = parseInt(idStr, 10);

  if (req.method === "GET" || req.method === "HEAD") {
    if (!exists(id)) await render(id);
  }

  const f = kind === "thumb" ? path.join(THUMB_DIR, id + ".webp") : path.join(POSTER_DIR, id + "." + ext);
  if (fs.existsSync(f)) {
    res.writeHead(200, {
      "content-type": ext === "png" ? "image/png" : "image/webp",
      "cache-control": "public, max-age=604800",
      "access-control-allow-origin": "*",
    });
    fs.createReadStream(f).pipe(res);
  } else {
    res.writeHead(404);
    res.end("render failed");
  }
}).listen(PORT, "127.0.0.1", () => log("渲染服务已启动 :" + PORT));

poll();
setInterval(poll, 45000);
