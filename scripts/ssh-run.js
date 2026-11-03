/**
 * 远程执行命令的小工具
 *   node scripts/ssh-run.js "命令1" "命令2" ...
 */
const { Client } = require("ssh2");

const HOST = process.env.FZ_HOST || "45.153.130.70";
const USER = process.env.FZ_USER || "root";
const PASS = process.env.FZ_PASS || "Ax6armNbfSOd0O";

const cmds = process.argv.slice(2);
if (!cmds.length) { console.error("用法: node scripts/ssh-run.js \"/cmd1\" \"/cmd2\""); process.exit(1); }

const conn = new Client();
conn.on("ready", async () => {
  for (const c of cmds) {
    await new Promise((res) => {
      conn.exec(c, (err, stream) => {
        if (err) { console.log("ERR " + err.message); return res(); }
        let out = "", errOut = "";
        stream.on("data", (d) => (out += d));
        stream.stderr.on("data", (d) => (errOut += d));
        stream.on("close", () => {
          if (out.trim()) console.log(out.trim());
          if (errOut.trim()) console.log("[stderr] " + errOut.trim().slice(0, 400));
          res();
        });
      });
    });
  }
  conn.end();
});
conn.on("error", (e) => { console.error("连接失败: " + e.message); process.exit(1); });
conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 25000 });
