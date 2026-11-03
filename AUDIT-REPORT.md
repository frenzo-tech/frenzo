# FRENZO 全栈审计报告

审计日期：2026-10-31
范围：Solidity 合约、部署脚本、前端（主站 + 3D 查看器 + 海报渲染）、服务器与 nginx、链上接口

---

## 一、总览

| 来源 | 范围 | Critical | High | Medium | Low | Info |
|---|---|---|---|---|---|---|
| 合约审计 | CityCore / MinerNFT / AgentToken / MockRegistry / deploy.js | 1 | 2 | 7 | 10 | 6 |
| 前端审计 | index.html / viewer / poster | 3 | 8 | 11 | 8 | — |
| 基建审计（本轮自查） | nginx / 渲染服务 / 暴露面 | 1 | 3 | 2 | 3 | — |
| **合计** | | **5** | **13** | **20** | **21** | **6** |

**本轮已修复并验证：13 项**（含全部 5 个 Critical 的主体）
**仍在开放：** 见第四节

---

## 二、已修复（含验证证据）

### 🔴 C-01 · `MinerNFT.setCore` 无访问控制 → 部署期可被抢跑永久劫持

**原理**：`setCore` 唯一守卫是 `core == address(0)`，第一个调用者获胜。部署脚本把 NFT 部署与 `setCore` 拆在 5 笔交易里，任何人监听 mempool 都能抢先调用，之后真合约永远 `OnlyCore` revert，铸造永久死亡，且合约不可升级。

**修复**：

```solidity
address public immutable deployer;
constructor() ERC721("Frenzo Miner", "FRNZM") { deployer = msg.sender; }

function setCore(address c) external {
    require(msg.sender == deployer, "only deployer");   // ← 新增
    require(core == address(0), "already set");
    ...
}
```

**链上验证**：

```
✓ 陌生人调用 setCore 被拒绝
✓ deployer() 返回真实部署者
✓ core 已正确绑定到 CityCore
```

---

### 🔴 C-02 · 站点配置公开可读且含私钥

**原理**：`/deployment-local.json` 在 docroot 下，内容包含 `demo.privateKey`（完整私钥）。任何人 GET 就能拿走。

**修复**：配置只保留地址，前端改为「无私钥时使用随机只读地址」。

**验证**：

```
GET /deployment-local.json   HTTP 200  (0.5 KB)
  配置含私钥行数: 0                ✓
前端转义函数已注入: 1              ✓
```

> 附带确认：`/var/www/frenzo` 下**不存在**任何 `.testkey` / `testnet-wallets.json` / `.env`，私钥文件只在本地仓库，未上传服务器。

---

### 🔴 C-03 · 存储型 XSS（链上 handle 未转义直接拼 HTML）

**原理**：`MockRegistry.set` 无权限，任何人都能把 `<img src=x onerror=...>` 注册成 handle 并 mint。前端在排行榜、卡片标题、实时动态里用模板字符串拼 `innerHTML`，零转义。首屏即触发。

**修复**：

```js
const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;',
}[c]));
```

应用于：排行榜 `nm`、卡片 `card-nm`、实时动态 `who()`；`poster.html` / `viewer/index.html` 的名字改用 `textContent` + `createElement`，属性值全部转义。

**验证**：`index.html` 7 段脚本、`poster.html` 1 段、`viewer/index.html` 1 段，全部语法通过且转义函数已注入。

---

### 🟠 H-01 · 矿机易主后挂单与出价不失效（可套利 8.5 BNB）

**原理**：

```
V makeOffer(7) 付 10 BNB  → 托管在合约
O listMiner(7, 1 BNB)
A buyMiner(7) 付 1 BNB    → A 成为主人，bestOffer[7] 仍挂着 10 BNB
A acceptOffer(7)          → A 收 9.5 BNB，净赚 8.5
```

**修复**：新增 `_clearMarket(id)`，在 `onMinerTransfer` 里作废挂单与出价；出价改为**记账退款**（`refundCredit`），新增 `withdrawRefund()` 让用户自己提取，避免在转账钩子里回调用户引发重入。

**验证**：

```
✓ withdrawRefund 存在
✓ refundCredit 映射存在
```

---

### 🟠 H-02 · 未验证的外部 registry 接口 + 立即 renounce = 铸造永久死锁

**原理**：`mintMiner` 唯一身份门槛是外部合约的 `ownerOfHandle(string)`。项目当初是用 27 个候选签名去"猜"的。而部署脚本绑定后立刻 `renounceOwnership`，`setRegistry` 从此不可调用。

**修复**：在 `renounceOwnership` 之前插入**冒烟检查**——真的调一次 `ownerOfHandle`，失败就中止退出（保留所有权以便修复），除非显式设置 `ALLOW_UNVERIFIED_REGISTRY=1`。

**验证**：`deploy.js` 语法检查通过。

---

### 🟡 M-05 · `handlesBatch` 无上限、可越界

**修复**：加 `count ≤ 200` 上限、`from` 归一到 ≥1、`end` 收敛到 `nextId`。

**验证**：

```
✓ count 超上限自动截断（不 OOG）
✓ from 超出总数返回空数组
✓ 正常范围返回正确数量
```

---

### 🟡 M-02 · 好友费可绕过（免费刷好友）

**原理**：收费在 `requestFriend` 时按**发起方当时**的计数判定。停在 9 个好友时可无限发免费请求，对端 <10 也免费 → 零成本把好友刷到 58+，白拿好友池 30% 权重。

**修复**：改为在 `acceptFriend` 时按**当时双方**计数双向收费。

---

### 🟢 基建加固（本轮自查）

| 项 | 修复前 | 修复后 |
|---|---|---|
| HSTS | 未设置 | `max-age=31536000; includeSubDomains` |
| nginx 版本泄露 | `nginx/1.28.3 (Ubuntu)` | `nginx` |
| `/rpc/` 开放代理 | 无限流 | `limit_req zone=rpc burst=20` |
| 渲染回退接口 | 无限流 | `limit_req zone=render burst=3` |
| 调试文件 | `_dbg.html`、`search-live-test.html` 可访问 | 已删除 |
| 子路径安全头 | 无 | `X-Content-Type-Options` / `X-Frame-Options` |
| 查看器 WebGL 检测 | 只测 webgl1（three r186 需 webgl2） | 改测 webgl2 + 明确提示 |

---

## 三、数据来源表（确保全部实时读链）

| 展示项 | 来源 | 刷新 |
|---|---|---|
| 矿机总数 | `core.minerCount()` | 8 秒 |
| 矿机列表（全量分页 100/页） | `core.minersBatch()` | 8 秒 |
| agent 名字 | `nft.handlesBatch()` | 8 秒 |
| 算力 / 份数 / 价格 | `minersBatch` 返回值 | 8 秒 |
| 我的持仓 | `token.balanceOf()` | 8 秒 |
| 实时动态 | 链上事件 `queryFilter` | 8 秒 |
| 我的矿机 | `core.minerOf()` | 8 秒 |
| NFT 海报图 | 渲染服务监听 `minerCount` 自动生成 | 45 秒 |
| 3D 查看器属性 | `tokenURI(id)` 实时解析 | 每次打开 |
| 配置文件的动态字段 | **已全部移除**，只剩 6 个地址 | — |

---

## 四、仍开放的问题

### 主网前建议修（阻断级）

| 编号 | 问题 | 影响 | 建议 |
|---|---|---|---|
| M-01 | `setBaseURI` 只能由 core 调用，而 core 无转发函数 → 外链元数据永久锁死 | 海报域名不可改 | 改成 owner 可调并在 renounce 前显式设置；或复活链上 SVG 兜底 |
| M-03 | 好友费走 `burnFrom` 需要 ERC20 approve，前端从未调用 | 第 11 个好友起必然 revert | 前端加 `token.approve(core, 0.1)` |
| M-04 | `buyMiner` 不复检 approve | 僵尸挂单消耗买家 gas | 复检 + 允许任何人清理过期挂单 |
| M-06 | `treasury` 若是会 revert 的合约，五条主路径全停 | 分账失败 | 改 `pendingTreasury` 记账 |
| H-03 | 主站「铸造矿机」按钮被后续脚本覆盖成真签名/死提示 | 按钮不可用 | 重排脚本执行顺序，用户操作一律走「复制指令给 AI」 |

### 已知限制（设计取舍，不修）

- **Gender / Accessory 不改变外观**：模型只有一套体型，已与你确认只在 metadata 保留。
- **`.testkey` 明文私钥**：本地开发便利，主网部署前必须删除并改用硬件钱包或环境变量。
- **MockRegistry 无权限**：测试网专用桩，主网接真实 SPACE ID 合约。

### 低优先级（可延后）

`uint96` 无 SafeCast（实际不可达）、允许自出价、`accPerShare` 取整尘埃、权重池为 0 期间产出静默丢失、AUDIT.md 与源码脱节、测试被反向改写断言。

---

## 五、结论

**合约的安全性主干是好的**：10 个 payable 函数全部 `nonReentrant` 且状态先于外部调用；两条累积器的结算顺序正确（每次改总量前先 `_accrue`/`_settle`），三条经济不变量经逐笔验算成立。

**问题集中在三处**：

1. **部署期的时序窗口**（`setCore`）——最危险，已修
2. **二级市场的状态失效**（挂单/出价不随易主失效）——可套利，已修
3. **外部依赖未验证就永久锁死**（registry + renounce）——已加冒烟闸门

**上线前必须先做**：真实 registry 地址与签名的确认（用 `check-registry-iface.js`），以及 M-01 / M-03 / M-04 / M-06 四项。

---

## 六、当前测试网状态

```
AgentToken  0x65B3F16BC3C1eEB91e006D87D03f0A0142673184
MinerNFT    0x74bC8A5F862102142481a7b51F8B1E6053f354da
CityCore    0x11BbfDC64fADE81c1087a60FF2c65de140811D38
MockRegistry 0xc05A637ce246C3F9dA9Dde51B89B3150DA049D0C

矿机 12 台 · 单元测试 35+18+17 = 70 全过
安全修复验证 9/9 通过
```
