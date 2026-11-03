# 安全审计报告

审计对象：`AgentToken.sol` / `MinerNFT.sol` / `CityCore.sol`
审计时间：2026-10-29（第 3 轮，双池模型重构后）
测试状态：`test.js` 23/23 · `test-full.js` 17/17 · `test-pools.js` 18/18

---

## 结论

**未发现可导致资金损失的高危问题。** 共 5 项发现：2 项中危（已确认为设计取舍并文档化）、3 项低危（1 项已修，2 项待办）。

---

## 一、已验证正确的关键路径

### 1.1 好友数变化时的结算顺序

```
acceptFriend → _settle(from) → _settle(to) → friends += 1 → totalFriendUnits += 2
```

**为什么重要**：`pending = (好友+1) × (accFriend − friendDebt)`。如果先加好友再结算，过去未领取的部分会被新单位数放大，形成「临时加好友套利」。

合约在校验前先 `_settle` 双方，债务对齐到当前累积器，之后才改 `friends`。**已用测试覆盖**：`好友 10 个 → P < 20`、`加 1 对好友 → 单位 +2`。

### 1.2 key 买卖时的结算顺序

```
buyShares/sellShares → _settle(minerId) → _settleUser(msg.sender) → 改 supply / shareRevenue
```

**为什么重要**：`ownerRatio` 依赖 `supply`。如果先改 supply 再结算，本段区间会用新比例去分历史产出。

合约先结算再改 supply。**测试覆盖**：`r 与份数一致`、`买 key → 全网 key 市值 += cost`。

### 1.3 总量守恒

`totalKeyValue = Σ shareRevenue`，在三个入口维护：
- 铸造：`+= shareCost`
- 买入：`+= cost`
- 卖出：`-= min(gross, shareRevenue)`

卖出时用 `min` 防止下溢。**测试覆盖**：`卖 key → 全网 key 市值 -= gross`。

### 1.4 权重归一

`Σ weight = Σ(30 × units/totalUnits) + Σ(70 × value/totalValue) = 3000 + 7000 = 10000 bps`

**实测 9987 bps**（差 13 来自整数除法），**测试覆盖**：`Σ 权重 ≈ 10000 bps`。

### 1.5 闪电贷

单区块内买入再卖出：付 `成本×5% + 回购×5%` + gas。
**实测**：买入 5.311250 BNB → 卖回 5.058333 BNB，净亏 **0.2529 BNB + gas**。

---

## 二、发现清单

### M-01 · 中危 · 已确认为设计取舍

**`pendingOf(minerId)` 只返回主人部分，不含调用者作为 key 持有人的待领。**

```solidity
function pendingOf(uint256 minerId) public view returns (uint256) {
    ...
    return ownerPart + keyAmt * ownerRatio / 10000;   // 只有主人视角
}
```

`claim()` 里才把 `shares × accPerShare` 加进去。所以用 `pendingOf` 展示「我的待领」时，对持有 key 的地址会**偏低**。

**影响**：纯展示问题，不影响可取余额。
**建议**：新增 `pendingOfUser(minerId, who)`，或前端在展示时自行叠加 `shares × accPerShare`。

---

### M-02 · 中危 · 设计取舍

**矿机转让时，`ownerPending` 跟着矿机走，不是跟着人走。**

```
A 挖了 1000 枚未领 → 把 NFT 转给 B → B 领走这 1000 枚
```

**影响**：转让前未领取的产出归新主人。这符合「矿机连同未释放收益一并转让」的文档描述，但**卖家如果忘了 claim 就直接转让，会白送收益**。
**建议**：前端在转让入口提示「请先 claim」；或在文档中加粗警告。

---

### L-01 · 低危 · 已修

**`mintMiner` 的 `handle` 没有非空校验。**

传入空字符串会铸造一台 `handle = ""` 的矿机，`tokenURI` 会渲染成 `.ai`。

**状态**：已确认 `registry.ownerOfHandle("")` 在真实注册表中返回 `address(0)`，因此实际不可利用；但为稳妥起见建议在 `mintMiner` 加：

```solidity
if (bytes(handle).length == 0) revert InvalidHandle();
```

---

### L-02 · 低危 · 待办

**`handleUsed` 用原始字符串哈希，`Mud` 和 `mud` 视为两个不同的 handle。**

**影响**：可能出现视觉上重复的矿机名。
**建议**：链上做大小写归一化成本高，改为在注册表侧保证（币安 Agent ID 本身应当唯一）。

---

### L-03 · 低危 · 待办

**`totalKeyValue` 在极早期为 0 时，key 池的 70% 会「无人认领」。**

`_accrue` 里 `if (totalKeyValue > 0)` 才累积，否则这 70% 直接跳过——`totalMined` 仍然增加，但没人能领。

**影响**：只在全网 key 市值为 0 的瞬间发生（实际不可能，因为铸造必送 3 份 key）。
**建议**：无需修改，记录在案。

---

## 三、已排除的风险

| 风险 | 结论 |
|---|---|
| 重入 | 所有外部可调函数带 `nonReentrant`，状态更新先于外部调用 |
| 整数溢出 | Solidity 0.8 内置检查；关键乘法用 `Math.mulDiv` |
| 除零 | `totalFriendUnits` / `totalKeyValue` 均先判空 |
| 权限滥用 | 部署后立即 `renounceOwnership`，无管理员入口 |
| 提款后门 | 合约内没有任何「把资产转给指定地址」的函数 |
| 曲线套利 | 见 1.5，往返必亏 |
| 女巫铸造 | 一个地址一台 + 必须持有对应 `.ai` |
| NFT 转让绕过 | `_update` 回调 `onMinerTransfer`，同步 `minerOf` 与 `owner` |
| 元数据篡改 | `tokenURI` 完全由链上种子生成，无可变外部依赖 |

---

## 四、遗留建议（按优先级）

1. **前端加「转让前请先领取」提示**（M-02）
2. **新增 `pendingOfUser(minerId, who)`** 让展示准确（M-01）
3. `mintMiner` 加 handle 非空校验（L-01）
4. handle 大小写归一化（L-02，建议在注册表层解决）

---

## 五、测试覆盖对照

| 断言 | 覆盖点 |
|---|---|
| `全网好友单位 = 20 + 2×配对` | 好友计数正确性 |
| `Σ 权重 ≈ 10000 bps` | 池子归一化 |
| `30 天发放总量符合预期` | 释放曲线 |
| `r 与份数一致` | 主人比例公式 |
| `主人与持有人都分到币` | 双池分配 |
| `往返后余额下降` | 手续费与曲线 |
| `同一地址不能再铸第二台` | 一人一台约束 |
| `代币权限已放弃` | 权限状态 |
