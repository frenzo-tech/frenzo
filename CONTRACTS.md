# Frenzo 合约清单

四个合约 + 一个外部接口。部署顺序：Registry → Token → NFT → Core，然后双向绑定，最后放弃权限。

---

## 1. AgentToken.sol — `$FRNZ` 代币

| 项目 | 内容 |
|---|---|
| 类型 | ERC20（OpenZeppelin） |
| 名称 / 符号 | Frenzo / `FRNZ` |
| 总量上限 | 100,000,000（硬顶，写死在合约里） |
| 小数位 | 18 |
| 部署后权限 | 所有者已放弃 |

**函数**

| 函数 | 谁能调 | 作用 |
|---|---|---|
| `setMinter(address)` | 部署者，仅一次 | 绑定铸币者（CityCore） |
| `mint(to, amount)` | 仅 minter | 铸造，受总量上限约束 |
| `burn(amount)` | 任何人 | 烧自己的 |
| `burnFrom(from, amount)` | 有授权额度的人 | 烧别人的（好友费、回购销毁用） |

**谁在用**
- CityCore 在 `claim` 时 mint
- CityCore 在加好友时 `burnFrom`
- 平台回购后用 `burnFrom` 销毁

---

## 2. MinerNFT.sol — 矿机 NFT

| 项目 | 内容 |
|---|---|
| 类型 | ERC721 |
| 名称 / 符号 | Agent Miner / `MINER` |
| 供应 | 一个 `.ai` handle 一台，无上限 |
| 元数据 | **完全链上生成**，无 IPFS、无服务器 |

**函数**

| 函数 | 谁能调 | 作用 |
|---|---|---|
| `setCore(address)` | 部署者，仅一次 | 绑定核心合约 |
| `mint(to, handle)` | 仅 core | 铸造，防重复 handle |
| `tokenURI(id)` | 任何人 | 返回 base64 的 JSON，内含 base64 的 SVG |
| `handleOf(id)` | 任何人 | 查 tokenId 对应的 handle |
| `handleUsed(hash)` | 任何人 | 查 handle 是否已被占用 |
| `_update(...)` | 内部 | 转让时回调 `CityCore.onMinerTransfer` |

**链上图像**
- 用 `keccak256(id, handle)` 做种子
- 8 组渐变色板按种子取一组，旋转角度也由种子决定
- 楼块数量 6~12 个，高度宽度由种子派生 → 每台矿机图案唯一且可复现
- 输出：深色卡片 + 光斑 + 天际线 + `handle.ai` + `MINER #id`

---

## 3. CityCore.sol — 核心逻辑（全部经济规则）

| 项目 | 内容 |
|---|---|
| 类型 | 普通合约（Ownable，部署后放弃） |
| 职责 | 矿机、好友、key、挖矿分配、曲线定价、手续费 |

### 3.1 铸造

| 函数 | 作用 |
|---|---|
| `mintMiner(handle)` | 一个地址一台；铸造价一半折成 key 记在主人名下，其余进金库 |
| `mintPrice()` | 阶梯价：每 1,000 台 +0.0002 BNB |
| `minerOf(address)` | 地址 → 矿机编号 |

### 3.2 好友

| 函数 | 作用 |
|---|---|
| `requestFriend(toMiner)` | 发起；自己好友 ≥10 时烧 0.1 FRNZ |
| `acceptFriend(reqId)` | 接受；接受方好友 ≥10 时也烧 0.1 FRNZ |
| `areFriends(a, b)` | 查询是否好友 |
| `onMinerTransfer(id, from, to)` | 仅 NFT 合约可调，转让时同步归属 |

### 3.3 key（份额）

| 函数 | 作用 |
|---|---|
| `buyShares(minerId, amount)` | 按曲线买入，5% 手续费进金库 |
| `sellShares(minerId, amount)` | 按曲线卖回，5% 手续费进金库 |
| `sharePrice(supply)` | 单价 = supply² / 100,000 |
| `costToBuy(a, b)` | 区间成本 = (b³−a³)/(3×100,000) |
| `ownerRatio(supply)` | 主人从 key 池拿多少：100%→20% |

### 3.4 挖矿

| 函数 | 作用 |
|---|---|
| `claim(minerId)` | 领取，代币实时铸造 |
| `pendingOf(minerId)` | 待领数量（主人部分） |
| `_accrue()` | 每秒累积，30% 进好友池、70% 进 key 池 |
| `_settle(minerId)` | 结算一台矿机，好友池全给主人，key 池按 r 拆 |

### 3.5 查询

| 函数 | 作用 |
|---|---|
| `minerInfo(id)` | 一次拿全：owner/friends/supply/shareRevenue/weight/price/ownerPending |
| `minersBatch(from, count)` | 批量拉取，前端一次拿一屏 |
| `totalFriendUnits()` | 全网 Σ(好友+1) |
| `totalKeyValue()` | 全网 Σ(key 市值) |

---

## 4. MockRegistry.sol — 测试用 `.ai` 注册表

| 项目 | 内容 |
|---|---|
| 用途 | **仅本地测试**，BSC 上换成币安真实 Agent ID 合约 |
| 函数 | `set(handle, owner)`、`ownerOfHandle(handle)` |

生产环境把构造函数里的 registry 地址指向币安合约即可，CityCore 只调用 `ownerOfHandle` 一个方法。

---

## 5. IBinanceAgentID — 外部接口

```solidity
interface IBinanceAgentID {
    function ownerOfHandle(string calldata handle) external view returns (address);
}
```

CityCore 用它校验「铸造者是否真的持有这个 `.ai`」。

---

## 部署后的权限状态

| 合约 | 所有者 | 可否再改 |
|---|---|---|
| AgentToken | `0x0`（已放弃） | 不能 |
| CityCore | `0x0`（已放弃） | 不能 |
| MinerNFT | 无 Ownable | 只有 `setCore` 一次性 |
| MockRegistry | 部署者 | 仅测试网使用 |

---

## 部署顺序

```
1. MockRegistry        （或币安 Agent ID 合约）
2. AgentToken
3. MinerNFT
4. CityCore(token, nft, registry, treasury)
5. token.setMinter(core)      一次性
6. nft.setCore(core)          一次性
7. core.setRegistry(registry)
8. token.renounceOwnership()
9. core.renounceOwnership()
```

脚本见 `scripts/deploy.js`（BSC）与 `scripts/local-chain.js`（本地）。
