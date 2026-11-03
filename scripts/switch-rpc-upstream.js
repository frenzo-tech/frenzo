/**
 * 切换 nginx /rpc/ 的上游节点（主网 / 测试网）
 *   node scripts/switch-rpc-upstream.js mainnet
 *   node scripts/switch-rpc-upstream.js testnet
 */
const { Client } = require("ssh2");

const HOST = process.env.FZ_HOST || "45.153.130.144";
const PASS = process.env.FZ_PASS || "";

const UPSTREAMS = {
  mainnet: "bsc-mainnet.public.blastapi.io",
  testnet: "bsc-testnet-rpc.publicnode.com",
};

const which = process.argv[2] === "mainnet" ? "mainnet" : "testnet";
const host = UPSTREAMS[which];

const cmd = `
set -e
CONF=/etc/nginx/sites-enabled/frenzo.tech.conf
cp "$CONF" "$CONF.bak.$(date +%s)"

# 替换 proxy_pass 和 Host 两行
sed -i -E 's|proxy_pass https://[^;]+/;|proxy_pass https://${host}/;|' "$CONF"
sed -i -E 's|proxy_set_header Host [a-z0-9.\\-]+;|proxy_set_header Host ${host};|' "$CONF"

echo "=== 修改后 ==="
grep -A2 'location \\^\\^ /rpc/' "$CONF" | head -4
grep -E 'proxy_pass https://|proxy_set_header Host ' "$CONF" | head -4

echo "=== 语法检查 ==="
nginx -t 2>&1 | tail -2
`;

const c = new Client();
c.on("ready", () => {
  c.exec(cmd, (e, st) => {
    let o = "";
    st.on("data", (d) => (o += d));
    st.stderr.on("data", (d) => (o += d));
    st.on("close", () => {
      console.log(o.trim());
      // reload
      c.exec("systemctl reload nginx && echo RELOADED", (e2, st2) => {
        let o2 = "";
        st2.on("data", (d) => (o2 += d));
        st2.on("close", () => { console.log(o2.trim()); c.end(); });
      });
    });
  });
});
c.on("error", (e) => { console.error("连接失败 " + e.message); process.exit(1); });
c.connect({ host: HOST, port: 22, username: "root", password: PASS, readyTimeout: 30000 });
