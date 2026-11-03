# Frenzo / Agent City 合约审计报告 (v2)

审计对象：`contracts/CityCore.sol` (797 行)、`contracts/MinerNFT.sol` (320 行)、`contracts/AgentToken.sol` (55 行)、`contracts/MockRegistry.sol` (15 行)、`scripts/deploy.js` (149 行)、`scripts/test*.js`
审计日期：2026-10-31（对 AUDIT.md「第 3 轮」之后的代码现状重审）
编译配置：`pragma solidity ^0.8.24`，OpenZeppelin v5（`ReentrancyGuard` / `Ownable` / `ERC721` / `ERC20` / `Math.mulDiv`）

**结论：发现 1 项 Critical、2 项 High、7 项 Medium、8 项 Low、6 项 Info。**
AUDIT.md 的结论「未发现可导致资金损失的高危问题」**已不成立** —— 该报告第 3 行的审计范围只覆盖 `AgentToken/MinerNFT/CityCore` 的挖矿与 key 模型，而**二级市场 + 出价模块（CityCore.sol:659-796）从未进入审计范围**，本次 Critical/High 均落在该区间与部署脚本。

---

## 一、逐项检查结论（9 个重点）

| # | 重点 | 结论 | 依据 |
|---|---|---|---|
| 1 | 重入 / CEI / ReentrancyGuard | **基本通过**（10/10 payable 与状态变更函数带 `nonReentrant`，状态先于外部调用）；1 处顺序隐患见 L-05 | 346/409/448/555/593/615/665/687/727/746/759 均带 guard |
| 2 | 访问控制完整性 | **未通过**：`MinerNFT.setCore` 无任何权限校验（C-01）；`setBaseURI` 权限指向了一个不存在的调用者（H-03/M-01） | MinerNFT.sol:44-49、275-279 |
| 3 | 整数与精度 | **通过**：Sol 0.8 内建检查 + `Math.mulDiv` 512 位；`x*x*x` 先乘后 mulDiv 属形式问题，实测算术不可达（L-01/Info） | 326-339 |
| 4 | 经济不变量（4 条） | **3 条成立**；`Σweight≈10000bps` 只是展示口径且逐项向下取整；`合约余额≥totalKeyValue` 无运行时校验 | 239-248、492-510、531-552 |
| 5 | 边界（0 份 / KV=0 / 好友≥10 / 卖空 / 自出价 / 被抢先 / 挂单后转移） | **5 项通过，2 项有问题**：好友≥10 收费可批量绕过（M-02）；挂单后转移留僵尸挂单（M-04） | 593-640、665-713 |
| 6 | DoS / 循环 / gas | **minersBatch 通过**（cap 200）；**handlesBatch 未通过**（无上限，M-05） | 285-321、MinerNFT:266-269 |
| 7 | 授权残留 | **未通过**：`buyMiner` 成交时不复检 approve / owner，撤授权后挂单永久不可成交（M-04） | 687-713 |
| 8 | tokenURI 外链 / handlesBatch 越界 | **格式通过**（`image` / `animation_url` 与 `verify-tokenuri.js:38-39` 正则一致）；**可用性未通过**（M-01：新 id 无海报、URL 永久不可改）；`handlesBatch` 无内存越界，但语义越界（返回空串） | MinerNFT:281-298、266-269 |
| 9 | 前端可被利用点 | **低风险但存在输入校验缺失**：`parseInt` 无上下界、在地端重复实现曲线积分（L-09/L-10） | index.html:1099-1107、1122 |

---

## 二、Critical

### C-01 · `MinerNFT.setCore` 无访问控制 + 部署脚本分 5 笔交易 → 部署期抢跑永久劫持 NFT

**文件:行号**：`contracts/MinerNFT.sol:44-49`（漏洞）、`scripts/deploy.js:89`（部署 NFT）、`scripts/deploy.js:111`（绑定 core）

```solidity
// MinerNFT.sol:44-49
function setCore(address c) external {
    require(core == address(0), "already set");   // 只校验"还没设过"
    require(c != address(0), "zero addr");        // 谁都能调用
    core = c;
    emit CoreSet(c);
}
```

**问题描述**
`setCore` 的唯一守卫是「core 还是 0」，即**第一个调用者获胜**。而 `deploy.js` 把 MinerNFT 的部署（第 89 行）与 `setCore`（第 111 行）拆在 5 笔不同交易里：`AgentToken`(88) → `MinerNFT`(89) → `MockRegistry`(96) → `CityCore`(101) → `setMinter`(109) → `setCore`(111)。这中间有 4 个区块的窗口，任何人都能抢先调用。

**可利用场景（具体到函数调用）**
1. 攻击者监听 mempool，看到 `deploy.js` 的 `MinerNFT` 部署交易；
2. 在同一区块或下一区块，用更高 gas 发 `MinerNFT(0x331A...).setCore(0xATTACKER)`；
3. 攻击者的交易先被打包，`core = 0xATTACKER`；
4. deploy.js 第 111 行的 `nft.setCore(core)` **必然 revert**（`already set`），整个部署中断；
5. 即使人工重跑脚本也无法挽救：`core` 只能设一次，`MinerNFT` 既不可升级也没有 owner。

**后果**
- 真正的 `CityCore.mintMiner` 会在 `nft.mint`（CityCore.sol:354）处因 `OnlyCore` **永久 revert** → 铸造永久死亡；
- 攻击者作为 core 可以：随意 `mint(to, handle)` 伪造任意 handle 的"官方矿机"（`handleUsed` 由他控制）、调用 `setBaseURI`（MinerNFT:275-279 校验 `msg.sender == core`）把**全部** tokenURI 的 `image`/`animation_url` 改到自己的域名（钓鱼/替换美术）。
- 完全不可恢复，无需任何特权假设。**真实问题。**

**修复建议**
```solidity
// MinerNFT.sol
address public immutable deployer;

constructor() ERC721("Frenzo Miner", "FRNZM") { deployer = msg.sender; }

function setCore(address c) external {
    require(msg.sender == deployer, "only deployer");   // 部署者绑定
    require(core == address(0), "already set");
    require(c != address(0), "zero addr");
    core = c;
    emit CoreSet(c);
}
```
更彻底的做法是把两步做成原子的（消除窗口，而不只是加权限）：
```solidity
// Deployer.sol —— 一个构造函数里完成 NFT+Core 部署与绑定，同一个 tx 内不可能被插队
contract Deployer {
    constructor(address token, address registry, address treasury) {
        MinerNFT nft = new MinerNFT();
        CityCore core = new CityCore(token, address(nft), registry, treasury);
        nft.setCore(address(core));       // 仍在 Deployer 的 tx 内
        nft.transferCoreAdmin(msg.sender);
    }
}
```
最小改动版（保持现有脚本结构）：把 `deploy.js:89` 与 `111` 合并为一次 `multicall`/`Batch`，或先 `setCore` 到预计算的 CREATE2 地址。

---

## 三、High

### H-01 · 二级市场：出价与挂单在矿机易主后不失效，托管出价被"新主人"截走

**文件:行号**
- `CityCore.sol:687-713` `buyMiner` —— 只 `delete listings[id]`（692），**不清 `bestOffer[id]`**
- `CityCore.sol:759-783` `acceptOffer` —— 只 `delete bestOffer[id]`（768），**不清 `listings[id]`**
- `CityCore.sol:646-657` `onMinerTransfer` —— 状态迁移入口，**两个市场结构都不清**
- `CityCore.sol:727-743` `makeOffer` —— 无 owner 绑定、无过期时间

**问题描述**
`bestOffer[id]` 与 `listings[id]` 是「以 tokenId 为键」的，而不是「以 (tokenId, owner) 为键」。矿机换主人时两者都留在原地，而成交/接受时只校验 `miners[id].owner == msg.sender`，不校验 `offer/listings 是否由当前主人创建`。于是**任何新主人都能兑现前任谈判出来的托管资金**。

**可利用场景（具体到函数调用）**
```
① 买家 V：makeOffer(7) 附带 10 BNB          → bestOffer[7] = {V, 10e18}，10 BNB 托管在合约
② 主人 O：listMiner(7, 1 BNB)                → listings[7] = {O, 1e18, true}（O 忘了自己还有 10 BNB 的挂单卖压）
③ 攻击者 A：buyMiner(7) 付 1 BNB             → A 成为 owner，listings 被清，bestOffer[7] 仍在
④ 攻击者 A：acceptOffer(7)                    → nft 转给 V，A 收到 10×95% = 9.5 BNB
   净收益 9.5 - 1 = 8.5 BNB，全部来自 V 的托管金 + O 本应得到的报价
```
第二条路径（不需要挂单）：
```
① V：makeOffer(7, 10 BNB)
② O 把 #7 直接转给 A（或 O 以任意价格卖给 A）
③ A：acceptOffer(7) —— V 无法在同一个区块里撤单（cancelOffer 是独立交易），只能被强制按旧价成交
```
第三条路径（僵尸挂单）：`acceptOffer` 不清 `listings`，所以 ②之后 `listings[7]` 仍是 `{O, 1e18, true}`，任何第三方 `buyMiner(7)` 都会在 `nft.transferFrom(L.seller=O, ...)`（699）处 revert —— 挂单永久不可成交，只有 O 自己能 `unlistMiner`。

**影响**
- 卖家的应收被第三方截走（O 的 9.5 BNB 被 A 拿走）；
- 买家的托管资金可被任意"未来主人"在任何时刻兑现，只能靠抢跑撤单自保（`cancelOffer` 746-753 是独立交易，没有原子保护）；
- 僵尸挂单使市场 UI 与实际可成交状态长期不一致。

**修复建议**
在唯一的产权迁移入口里做失效 + 退款，并把退款改成 pull 模式（`onMinerTransfer` 不持有 `nonReentrant`，不宜在钩子里直接 `.call`）：
```solidity
// CityCore.sol
mapping(address => uint256) public refundCredit;

function _invalidateMarket(uint256 id) private {
    delete listings[id];
    Offer memory o = bestOffer[id];
    if (o.amount > 0) {
        delete bestOffer[id];
        refundCredit[o.buyer] += o.amount;      // 记账，不在这里 call
        emit OfferCancelled(id, o.buyer);
    }
}

function onMinerTransfer(uint256 id, address from, address to) external {
    if (msg.sender != address(nft)) revert OnlyNFT();
    Miner storage m = miners[id];
    if (!m.exists) return;
    if (from != address(0) && to != from) _invalidateMarket(id);
    ...
}

function withdrawRefund() external nonReentrant {
    uint256 a = refundCredit[msg.sender];
    if (a == 0) revert ZeroAmount();
    refundCredit[msg.sender] = 0;
    (bool ok, ) = msg.sender.call{value: a}("");
    if (!ok) revert TransferFailed();
}
```
`acceptOffer` 里补 `delete listings[id];`，`buyMiner` 里补 `delete bestOffer[id]`（并走 `_invalidateMarket` 的退款路径）。

**真实问题**（不是设计取舍：AUDIT.md 全文没有提及出价/挂单的失效语义）。

---

### H-02 · `renounceOwnership` + 未验证的外部 registry 接口 = 铸造永久死锁且不可修复

**文件:行号**：`CityCore.sol:346-350`（依赖 `ownerOfHandle`）、`CityCore.sol:200-204`（`setRegistry` 是唯一修法）、`CityCore.sol:187`（构造可传任意地址）、`deploy.js:17`（硬编码主网注册表）、`deploy.js:115-119`（renounce）

```solidity
// CityCore.sol:350
if (registry.ownerOfHandle(handle) != msg.sender) revert NotHandleOwner();
// deploy.js:117-119
await (await core.renounceOwnership(...)).wait();
console.log("  → 参数永久锁定，任何人无法再改");
```

**问题描述**
`mintMiner` 的唯一身份门槛是一次外部 `staticcall`：`IBinanceAgentID.ownerOfHandle(string)`。这个接口签名**从未被验证**——项目自己写了 `scripts/check-registry-iface.js`，用 4 字节选择器去"猜"真实合约提供哪个函数（第 11-41 行列了 27 个候选），并在第 89 行明确写着「⚠ 没有 ownerOfHandle(string)，需要按上面的结果改合约」。而 `deploy.js` 在绑定之后立刻 `renounceOwnership`，`setRegistry`(200) 从此不可调用。

**可利用场景 / 触发条件**
- 情况 A：`0x60B926...022F` 是代理合约，逻辑实现里没有 `ownerOfHandle(string)` → 对它的调用返回 `0x` 或直接 revert → `mintMiner` 永久 revert；
- 情况 B：地址被写错/是 EOA → `staticcall` 返回空 → `abi.decode` revert → 同上；
- 情况 C：真实注册表在升级中改了函数名 → 同上。
任何一种情况下，`setRegistry` 已被 renounce 锁死，**没有任何补救路径**，铸造成本(0.0002 BNB) 的入口永久关闭，`minerCount` 永远停在已有数量。

**同类风险（同一根因）**：`CityCore.sol:187` 的 `registry = IBinanceAgentID(registry_)` 连 `registry_ != address(0)` 都没校验（对比同函数第 184 行对 token/nft 做了校验）。

**修复建议**
1. 部署脚本里加**选择器存在性 + 静态调用冒烟测试**，不通过就不部署、更不 renounce：
```js
const sel = ethers.id("ownerOfHandle(string)").slice(2, 10);
const code = await provider.getCode(registry);
if (code === "0x") throw new Error("registry 无代码");
if (!code.toLowerCase().includes(sel)) throw new Error("registry 缺少 ownerOfHandle(string)");
const probe = await core.ownerOfHandle.staticCall("sometesthandle");        // 必须不 revert
```
2. 不要在首发就放弃权限：先用 `Ownable2Step` 保留 `setRegistry`，或加 48h 时间锁；至少在完成一次真实链上 `mintMiner` 冒烟后再 renounce。
3. 构造函数补零地址校验：`require(registry_ != address(0), "zero");`

**真实问题**（部署期风险，一旦命中即不可逆）。

---

## 四、Medium

### M-01 · `setBaseURI` 只能由 core 调用，而 core 没有转发函数 → 外链元数据永久锁死 + 新 id 无海报

**文件:行号**：`MinerNFT.sol:275-279`（`setBaseURI` 守卫 `msg.sender != core`）、`MinerNFT.sol:272-273`（硬编码 frenzo.tech）、`MinerNFT.sol:290-291`（tokenURI 拼外链）、`MinerNFT.sol:133-233`（`_portrait` 已成死代码）、`scripts/gen-posters.js:13,113-114`（海报是手工批量生成）

**问题描述**
`setBaseURI` 要求 `msg.sender == core`，而 `CityCore` 里**不存在**任何调用 `nft.setBaseURI(...)` 的函数（全仓 grep 只有 `MinerNFT.sol` 与打补丁脚本 `patch-tokenuri.js` 提到它）。部署脚本也没有调用（且 EOA 调用必然 revert）。结论：`baseImageURI = "https://frenzo.tech/nft/poster/"`、`baseViewerURI = "https://frenzo.tech/viewer/?id="` 这两个字符串**在合约生命周期内永久不可修改**；同时链上矢量图 `_portrait` 全函数（133-233，含 `_split` 301-313）已无任何调用点，失去了唯一的去中心化回落。

叠加第二层问题：`image` 指向 `.../poster/{id}.png`，而海报由 `scripts/gen-posters.js` 按 `[起始id] [结束id]` **人工批量生成**（第 113-114 行 browser 截图写 `assets/posters/{id}.png`）。铸造是无许可的、id 无限增长，**任何在最后一次批量生成之后铸造的 id 都会得到一个 404 的 `image`**，且无法通过改 baseURI 切换方案。

**可利用场景**
- 域名过期/被抢注/迁移 → 全部 NFT 的 `image` 与 `animation_url` 同时失效，市场端只剩 `name`；
- 任意用户铸造 id=10001（超出海报批次）→ 该 NFT 永久无图，且这是**任何人都能触发**的（`mintMiner` 无门票）；
- 3D 查看器的形象来自 `viewer/index.html:91` 的静态快照 `../nft/chain.json`（不是链上），而 `tokenURI` 的 `attributes` 来自链上 `faceOf`（MinerNFT:98-109）—— 两个数据源会在新铸造/属性不一致时**互相矛盾**，`animation_url` 展示的角色与 `attributes` 不是同一只。

**修复建议**
```solidity
// 方案 A（最小改动）：把改 URI 的能力交给部署者，并在 deploy.js 里显式设置后再 renounce
function setBaseURI(string calldata img, string calldata viewer) external onlyOwner { ... }

// 方案 B（去中心化回落）：tokenURI 里优先外链、缺失时退回链上 SVG
function tokenURI(uint256 id) public view override returns (string memory) {
    _requireOwned(id);
    string memory h = handleOf[id];
    string memory sid = id.toString();
    string memory img = string.concat(
        '"image":"data:image/svg+xml;base64,',
        Base64.encode(bytes(_portrait(id, h))), '",'        // 复活 _portrait 作为兜底
    );
    ...
}
```
并让海报生成与铸造同步（监听 `MinerMinted` 事件出图，或直接在链上渲染）。

**真实问题**（可用性/元数据永久性；非资金损失，故列 Medium）。注意 AUDIT.md:138 仍写着「元数据篡改 | tokenURI 完全由链上种子生成，无可变外部依赖」——**该结论与当前代码相反**。

---

### M-02 · 好友费（0.1 代币）可被"攒请求"批量绕过

**文件:行号**：`CityCore.sol:602-604`（发起时判定）、`CityCore.sol:629-631`（接受时判定）

```solidity
// requestFriend 602-604：按「发起这一刻」的 fm.friends 收费
if (fm.friends >= FRIEND_FREE) token.burnFrom(msg.sender, FRIEND_COST);
// acceptFriend 629-631：按「接受这一刻」的 tm.friends 收费
if (tm.friends >= FRIEND_FREE) token.burnFrom(msg.sender, FRIEND_COST);
```

**问题描述**
「前 10 个好友免费」被实现成**每次操作时读一次计数器**，而不是「累计第 11 个及以后收费」。由于好友数要在 `acceptFriend` 之后才 +1，一个停在 9 个好友的矿机可以**连续发起任意多个免费请求**；每个接受方自己也在 9 个好友以下时同样免费。

**可利用场景（具体到函数调用）**
```
① 攻击者 A 的矿机 #1 已有 9 个好友（fm.friends == 9）
② A 对 #2..#50 连续调用 requestFriend(i) 共 49 次  → 每次 9 < 10，全部免费，0 代币
③ 对端逐个调用 acceptFriend(reqId)                 → 各自 tm.friends < 10，也全部免费
④ 结果：#1 的好友数 9 → 58，全程没有支付过一次 FRIEND_COST
```
（对端若已满 10 会付费，但攻击者完全可以选择 9 好友以下的新矿机作为对端 —— 而新矿机铸造价只有 0.0002 BNB。）

**影响**：设计里作为通缩/消耗场景的 `FRIEND_COST` 被绕过；`friends` 直接决定好友池 30% 的分配权重（`_powerOf` 241-243、`_settle` 535），因此这是**免费提升挖矿权重**的路径，属于经济不变量被破坏。

**修复建议**：把双方计费都挪到「接受时刻」，按当时的真实计数判定：
```solidity
struct FriendReq { uint256 from; uint256 to; address fromOwner; address toOwner; bool active; }

function acceptFriend(uint256 reqId) external nonReentrant {
    FriendReq storage r = friendReqs[reqId];
    if (!r.active) revert InactiveRequest();
    if (msg.sender != r.toOwner) revert NotTarget();
    r.active = false;

    Miner storage fm = miners[r.from];
    Miner storage tm = miners[r.to];
    _settle(r.from);
    _settle(r.to);

    if (fm.friends >= FRIEND_FREE) token.burnFrom(r.fromOwner, FRIEND_COST); // 发起方此时才付
    if (tm.friends >= FRIEND_FREE) token.burnFrom(msg.sender, FRIEND_COST);
    ...
}
```
（配合 M-03 的授权方案，或把费用改成原生币/`transferFrom` 到金库，避免"需要预先授权"的 UX 陷阱。）

**真实问题。**

---

### M-03 · 好友费依赖 ERC20 allowance，但前端/文档都没有 approve 路径 → 10 个好友后功能静默失败

**文件:行号**：`CityCore.sol:603`、`CityCore.sol:630`（`token.burnFrom(msg.sender, FRIEND_COST)`）、`AgentToken.sol:51-54`（`burnFrom` 走 `_spendAllowance`）、`index.html:2069`、`index.html:2843`（文档只写"调用 requestFriend"）

**问题描述**
`burnFrom(from=用户, spender=CityCore)` 需要用户事先 `token.approve(cityCore, ≥0.1e18)`。全仓 `index.html` 只有 ERC721 的 `approve`（3662 行是 `MinerNFT.approve`），**从未调用 ERC20 的 approve**；文档（2069/2843 行）也只写"调用 requestFriend({对方编号})"。因此第 11 个好友开始，链上必然 revert（`ERC20InsufficientAllowance`），而 UI 只会弹一个通用失败。

**可利用场景**：不是攻击面，而是**功能不可用**——用户按官方文档操作必然失败，且失败原因不可见。

**修复建议**：前端在首次需要时补一次精确额度授权，并在文档写明：
```js
const need = await token.allowance(me, cfg.core);
if (need < FRIEND_COST) await (await token.approve(cfg.core, FRIEND_COST * 100n)).wait(); // 精确额度，不要 MaxUint256
```
后端同理；合约侧建议把 revert 语义做成可读错误（`error FriendFeeNotApproved()`）。

**真实问题（集成层）。**

---

### M-04 · 挂单依赖 approve 但成交时不复检 → 撤授权/已转移后挂单永久不可成交（僵尸挂单）

**文件:行号**：`CityCore.sol:665-674`（`listMiner` 只在此刻校验 approve，668）、`CityCore.sol:687-713`（`buyMiner` 只校验 `active` 与 `msg.value`，不校验 owner/approve）、`CityCore.sol:699`（`nft.transferFrom(L.seller, ...)`）

**问题描述**
`listMiner` 把「此刻有 approve」写进 `Listing.active`，但 `buyMiner` 从不复核：
- 卖家 `nft.approve(address(0), id)` 或 `setApprovalForAll(core,false)` 之后 → 699 行 `_checkAuthorized` revert（`ERC721InsufficientApproval`），挂单仍 `active`，只有卖家能 `unlistMiner`；
- 卖家把 NFT 直接转给别人之后 → 699 行 revert（`ERC721IncorrectOwner`），新主人无法 `unlistMiner`（679 行要求 `L.seller == msg.sender`），只能靠 `listMiner` 覆盖。
注意 `acceptOffer` 是**有**复检的（764-765），两者不一致。

**可利用场景**：卖家挂单后撤授权 = 免费的买家 gas 消耗器（挂一个低价、吸引点击、每次成交都 revert）；也构成"看起来在售但永远买不到"的钓鱼式误导。

**修复建议**
```solidity
function buyMiner(uint256 id) external payable nonReentrant {
    Listing memory L = listings[id];
    if (!L.active) revert NotListed();
    if (msg.value < L.price) revert Insufficient();
    if (nft.ownerOf(id) != L.seller ||
        !(nft.getApproved(id) == address(this) || nft.isApprovedForAll(L.seller, address(this)))) {
        delete listings[id];                 // 顺手清理，别留垃圾状态
        emit MinerUnlisted(id);
        revert NotApproved();
    }
    ...
}
```
并在 `onMinerTransfer` 里 `delete listings[id]`（与 H-01 同一处修复）。

**真实问题。**

---

### M-05 · `handlesBatch` 无数量上限、无边界校验

**文件:行号**：`contracts/MinerNFT.sol:266-269`

```solidity
function handlesBatch(uint256 from, uint256 count) external view returns (string[] memory out) {
    out = new string[](count);                    // 完全由调用者控制
    for (uint256 i = 0; i < count; i++) out[i] = handleOf[from + i];
}
```

**问题描述**
对比 `minersBatch`（CityCore.sol:299 有 `if (count > 200) count = 200` 且把 `end` 收敛到 `minerCount`），`handlesBatch` **一个都没有**：
- `count = 1e6` → `new string[](1e6)` 触发内存扩张 → OOG revert（view 函数，但任何把它放进交易的调用方会失败；公共 RPC 也有 gas 上限）；
- `from + i` 没有与 `nextId` 对齐 → id 越界时返回**空字符串**（Solidity mapping 读默认值，**不存在内存越界**），前端会把不存在的矿机渲染成空名字；
- `from = type(uint256).max` 时 `from + i` 溢出 → panic revert。

**可利用场景**：任何人铸造大量矿机后，前端一次 `handlesBatch(1, minerCount)` 就会 OOG；或攻击者构造 `count` 参数把调用方（含 render-service）打挂。

**修复建议**
```solidity
function handlesBatch(uint256 from, uint256 count) external view returns (string[] memory out) {
    if (from < 1) from = 1;
    if (count > 200) count = 200;                       // 与 minersBatch 对齐
    uint256 last = nextId - 1;
    uint256 end = from + count - 1;
    if (end > last) end = last;
    uint256 n = end >= from ? end - from + 1 : 0;
    out = new string[](n);
    for (uint256 i = 0; i < n; i++) out[i] = handleOf[from + i];
}
```

**真实问题。**

---

### M-06 · `treasury` 若是会 revert 的合约，`mintMiner/buyShares/sellShares/buyMiner/acceptOffer` 全部永久停摆

**文件:行号**：`CityCore.sol:194-198`（`setTreasury` 只校验非零）、`385`、`434`、`476`、`704`、`779`（全部是 `(bool ok,) = treasury.call{value:...}(""); if (!ok) revert;`）、`deploy.js:117`（renounce 后不可改）

**问题描述**
所有金库分账都是「转不出去就整体 revert」。一旦 treasury 指向一个 `receive()` 会 revert 的合约（多签改了实现、Gas 消耗型金库、被 selfdestruct 后重建的地址等），铸造、买 key、卖 key、二级市场成交、接受出价**五条主路径同时不可用**。`setTreasury` 是唯一修法，而它已被 renounce 锁死（H-02 同一根因）。

**修复建议**：分账改为 pull 模式或容错记账，绝不让金库地址的可用性阻塞用户交易：
```solidity
uint256 public pendingTreasury;
function _payTreasury(uint256 v) private {
    if (v == 0) return;
    (bool ok, ) = treasury.call{value: v}("");
    if (!ok) pendingTreasury += v;      // 记账挂起，用户交易照常成功
}
function flushTreasury() external {      // 任何人可催收
    uint256 v = pendingTreasury;
    pendingTreasury = 0;
    (bool ok, ) = treasury.call{value: v}("");
    if (!ok) { pendingTreasury = v; revert TransferFailed(); }
}
```
并保留 `setTreasury` 的 owner（或至少 2 步转移 + 时间锁），不要首发 renounce。

**真实问题（条件触发）。**

---

### M-07 · `MockRegistry.set` 无权限；`deployment-97.json` 指向的就是它 → handle 归属可被任意冒充

**文件:行号**：`contracts/MockRegistry.sol:8-10`、`deployment-97.json`（`"registry": "0xB8178b5215d36214CCd85d9ca4B7A23352E8dD78"`）、`deploy.js:95-99`（chainId≠56 时用 Mock）

```solidity
// MockRegistry.sol:8-10
function set(string calldata h, address a) external {   // 任何人都能改任意 handle
    owners[h] = a;
}
```

**问题描述**
`mintMiner` 的身份门槛（`ownerOfHandle(handle) == msg.sender`）在测试网上等于零门槛：任何地址都能 `MockRegistry.set("elonmusk", me)` 然后铸造 `elonmusk.ai` 矿机，也能把别人已注册但尚未铸造的 handle 抢走（抢跑 `mintMiner`）。当前线上站点（`deployment-local.json` / `deployment-97.json`，chainId 97）读的正是这个注册表。

**可利用场景**：`MockRegistry.set("binance", attacker)` → `CityCore.mintMiner("binance")` 成功 → 得到全站唯一的"官方感"矿机名。若任何对外叙事/截图/领奖依赖 handle 归属，即为可伪造。

**修复建议**：`set` 加 `onlyOwner` 或"首次声明后锁定"；更实际的是——**不要把 Mock 部署用于任何对外演示**，至少在前端对 chainId 97 明确标注"注册表为 Mock，handle 不作数"。主网上线必须换成真实注册表并完成 H-02 的冒烟验证。

**设计取舍 + 部署风险**（代码层面是测试桩，问题在于它真的被部署并接入了前端）。

---

## 五、Low

| 编号 | 标题 | 文件:行号 | 说明 | 修复 |
|---|---|---|---|---|
| L-01 | `uint96` 截断未用 SafeCast | `CityCore.sol:672`（`uint96(price)`）、`735`（`uint96(msg.value)`） | `price == 0` 的校验发生在**转换前**（667），`price = 2^96` 会通过校验并写入 `price = 0` → 生成 0 价挂单；`makeOffer` 存 0 则 `cancelOffer`(748) 因 `cur.amount == 0` 永远退不回。**可触发性极低**：2^96 wei = 79,228,162,514 BNB，高于 BNB 总量约 560 倍，故实际不可达，属"形式缺陷 + 未来改链风险" | `Listing.price = SafeCast.toUint96(price);`、`amount: SafeCast.toUint96(msg.value)`；或把结构体字段改成 `uint256` |
| L-02 | 允许自己给自己出价 | `CityCore.sol:727-743`（无 `msg.sender != m.owner` 判断） | 主人对自机出价后 `bestOffer[id]` 被自己占位，其他人必须**严格高于**该值才能出价（733），owner 可随时 `cancelOffer` 全额取回 → **零成本封锁他人出价**；自成交（`acceptOffer`）时 `nft.transferFrom(self, self)` 会经 `onMinerTransfer` 通过（651 先删 `minerOf[from]`），白付 5% 手续费 | `if (msg.sender == m.owner) revert SelfOffer();` |
| L-03 | 权重池为 0 期间的产出静默丢失，但 `totalMined` 照常推进 | `CityCore.sol:498-508`（`if (totalFriendUnits > 0)` / `if (totalKeyValue > 0)` 跳过但 `totalMined += reward` 在前面） | 部署→首台铸造之间的全部产出（30%+70%）无人可领却计入已挖，导致**最终总量永远 < 1e8**；AUDIT.md L-03 认为"实际不可能"，但"部署到第一次 mint"这段窗口是必然存在的 | 只累加真正分配出去的额度：`totalMined += used;`（见报告正文代码） |
| L-04 | 累加器向下取整的尘埃永久不可铸 | `CityCore.sol:503`、`506`、`549` | `accPerShare` 每次 settle 都 floor，Σ持有人可得 < `holderPart`；因代币是 claim 时才 mint，**不产生无偿付性**，仅总量略有通缩 | 记录在案即可；若在意可在 `_settle` 末尾把余数并入 `m.ownerPending` |
| L-05 | `mintMiner` 在 `nft.mint`（354）之后才写 Miner 状态（356-377） | `CityCore.sol:352-377` | 当前安全——`MinerNFT.mint` 用 `_mint`（MinerNFT.sol:59）不触发 `onERC721Received`。一旦改成 `_safeMint`，回调将在状态写入前发生，且 `onMinerTransfer` 未加 `nonReentrant`（646），属防御纵深缺口 | 把 Miner 初始化提到 `nft.mint` 之前；或在 `MinerNFT.mint` 加注释禁止改成 safe 版本，并补一条断言测试 |
| L-06 | 明文私钥 `.testkey` 存放在项目根目录，`deploy.js` 会自动回退使用 | `.testkey`（66 字节，`0x`+64 hex）、`deploy.js:36-40` | 无 `PRIVATE_KEY` 时脚本静默读取本地私钥；chainId 56 也会走这条路 → **可能用开发私钥部署主网**并写出 `deployment-56.json`；该目录还在 OneDrive 同步盘里 | 删除 `.testkey`；`deploy.js` 去掉回退分支，缺 key 直接 `throw`；仅在 chainId 97/31337 允许读文件；`.gitignore` + `.env` |
| L-07 | `FriendReq.toOwner` 过期后可被"前主人"代替接受 | `CityCore.sol:607`（快照 `tm.owner`）、`618`（只校验 `msg.sender == r.toOwner`） | 矿机转让后，**已不拥有该矿机的前主人**仍能 `acceptFriend`，替新主人的矿机加好友并消耗自己的代币（不影响资金安全，但扭曲好友权重） | 在 `onMinerTransfer` 里作废该矿机的挂起请求；或 accept 时校验 `miners[r.to].owner == msg.sender` |
| L-08 | `MinerNFT.burn` 与 core 的销毁路径没有维护 `minerCount/totalFriendUnits/totalKeyValue` | `MinerNFT.sol:63-65`、`CityCore.sol:646-657` | 若将来开放销毁：`m.exists` 仍为 true、`owner = address(0)`、`totalFriendUnits` 不减 → 该矿机的 30%/70% 权重成为**永久黑洞**（`claim` 无人可调，`ownerPending` 永远累积）。当前 `CityCore` 从不调用 `burn`，**不可达** | 要么删掉 `burn`，要么在 core 侧实现完整清算：`_settle` → `totalFriendUnits -= friends+1` → `totalKeyValue -= shareRevenue` → `minerCount -= 1` → `delete miners[id]` |
| L-09 | 前端 `parseInt` 无上下界/无小数校验 | `index.html:1099` | `parseInt("1.5") → 1`（用户以为买 1.5 份，实买 1 份）；`parseInt("1e9") → 1`；超长数字串返回 float，`BigInt(float)` 直接抛异常；`Math.max(1, ...)` 把负数静默变成 1 | `const raw = $('amtInput').value.trim(); if (!/^\d+$/.test(raw)) return toast('请输入正整数'); const qty = BigInt(raw); if (qty <= 0n || qty > 1_000_000n) return toast('数量超出范围');` |
| L-10 | 前端本地复算曲线积分，未调用链上 `costToBuy` | `index.html:1103-1107`（`integral()` + `gross+fee`） | 与 `curveIntegral`（331-333）目前一致（同为向下取整），但属于**双份实现**：任何一侧改动（例如引入 `mulDiv` 之外的取整、加动态费率）都会导致 `msg.value` 不足而 revert；且 `cur.supply` 是读时快照，被别人抢先买入就直接失败（无 slippage 参数，靠 revert 兜底，不会多付） | 直接 `await core.costToBuy(s, s+qty)`（ABI 已导出，586 行），并给 `buyShares` 加 `minAmountOut` 语义（合约侧新增参数） |

---

## 六、Info

| 编号 | 内容 | 文件:行号 |
|---|---|---|
| I-01 | **注释与实现已脱节**：头部公式写 `P = 100 × (...)`（第 19 行）与 `@dev P = 100e18 + (30e18·ratioF + 70e18·ratioV)/1e18`（227-229），但 `_powerOf`（239-248）返回的是**纯 bps 权重**（无 100 基线、30/70 直接相加，空矿机为 0）；第 33 行注释写 `1e28 / 94,608,000 ≈ 105.7e18`，而 `MAX_SUPPLY = 100_000_000e18 = 1e26`，实际 `REWARD_PER_SEC ≈ 1.057e18`（差 100 倍）；第 40 行注释重复出现两次 | CityCore.sol:19、33、40、227-229、239-248 |
| I-02 | **死代码**：`_log2Fixed`（212-223）无调用点（连带 `LOG2_101` 65、`VALUE_UNIT` 68 都无用）；`MinerNFT._portrait`（133-233）与 `_split`（301-313）在 tokenURI 改外链后也无调用点。删掉可省 ~4KB 部署字节码 | CityCore.sol:65,68,212-223；MinerNFT.sol:133-233,301-313 |
| I-03 | **AUDIT.md 已过期**：第 3 行声明的审计对象不含二级市场/出价（CityCore.sol:659-796），而 H-01 正落在这里；第 138 行"tokenURI 完全由链上种子生成，无可变外部依赖"与当前 MinerNFT.sol:290-291 相反；第 133 行"部署后立即 renounceOwnership，无管理员入口"把 H-02/M-06 的不可恢复性当成优点记录 | AUDIT.md:3、130-138 |
| I-04 | **测试绿灯不等于规格通过**：仓库里有大量 `fix-*-assert.js` / `patch-tests-*.js` 反向改写测试断言，例如 `patch-tests-3070.js:16-38` 把"新矿机属性 = 100"改成"= 0"、把"好友 10 个 → P ≈ 115.6"改成"≈ 15.6"；`fix-full-asserts.js:12-27` 把往返损耗测试的仓位从 10 份改成 100 份"让 gas 不至于抹平差异"。当前 `test.js/test-full.js/test-pools.js` 全绿只证明**实现与实现自洽**，不证明与设计文档一致 | scripts/patch-tests-3070.js、fix-full-asserts.js、fix-3070-assert.js、patch-tests-*.js |
| I-05 | **测试覆盖缺口**（对应本次 High 全部漏检）：没有任何用例覆盖「出价→矿机易主→新主人 acceptOffer」「挂单→转移→buyMiner」「挂单后撤 approve→buyMiner」「好友数 9 时批量 requestFriend」，`test.js:147-176` 的出价用例只测了"托管"和"被超价退款" | scripts/test.js:147-176 |
| I-06 | `power` 仅用于展示/排序（239 行注释自认），但前端用它估算日收益（`index.html:1078`），与实际双累加器分配口径不同 → 展示值会系统性偏离真实收益；`minerInfo` 返回的 `price` 是**边际价** `sharePrice(supply)`（319），不是一份的平均成本 | CityCore.sol:239-248, 319；index.html:1078 |

---

## 七、真实问题 vs 设计取舍

**真实问题（应修）**：C-01、H-01、H-02、M-01、M-02、M-03、M-04、M-05、M-06、L-01、L-02、L-03、L-05、L-06、L-07、L-09、L-10
**设计取舍（记录即可，需在文档中写明）**：
- 一人一台矿机 → 二级市场的买家必须**没有**矿机（`onMinerTransfer` 653），实际上只有"新入场地址"能接盘；这是市场流动性的结构性约束，不是 bug；
- `ownerPending` 随 NFT 走而不随人走（`claim` 561-564），卖家忘了 claim 就白送（AUDIT.md M-02）；
- `pendingOf` 只返回主人视角，不含持有人份额（AUDIT.md M-01）；
- `AgentToken.setMinter` 只能设置一次（32-37）+ renounce → minter 永久不可迁移，CityCore 若有 bug 无法换核心；
- `handle` 大小写不归一（AUDIT.md L-02）、`mintMiner` 不校验空 handle（AUDIT.md L-01，仍存在）；
- `requestFriend` 的请求永不删除（`friendReqs` 只置 `active=false`，619）→ 存储单调增长，无清理函数的取舍；
- 曲线买卖各 5% 手续费使往返套利无利可图（AUDIT.md 1.5 的实测结论，本次复核 `sellShares` 464 行 `gross - fee` 与 `buyShares` 421 行一致，成立）。

---

## 八、总结表

| 等级 | 数量 | 编号 |
|---|---|---|
| Critical | **1** | C-01 |
| High | **2** | H-01、H-02 |
| Medium | **7** | M-01 ~ M-07 |
| Low | **10** | L-01 ~ L-10 |
| Info | **6** | I-01 ~ I-06 |
| **合计** | **26** | |

- 资金安全相关：C-01、H-01、H-02、M-06（4 项）
- 经济模型相关：M-02、L-02、L-03、L-04（4 项）
- 元数据/可用性相关：M-01、M-05、M-07（3 项）
- 工程/流程相关：M-03、M-04、L-06、I-03、I-04（5 项）

### 上线前必须修（阻断发布）

1. **C-01**：`MinerNFT.setCore` 加 `deployer`/owner 守卫，并把 `deploy` + `setCore` 做成同一个交易（否则主网首发必被抢跑）。
2. **H-01**：`onMinerTransfer` 内作废 `listings` + 作废/退款 `bestOffer`（退款改 pull 模式）；`acceptOffer` 补 `delete listings[id]`，`buyMiner` 补失效出价。
3. **H-02**：部署脚本加 `ownerOfHandle(string)` 选择器探测 + 真实 `mintMiner` 静态冒烟；**在冒烟通过前不要 `renounceOwnership`**；`core` 构造函数补零地址校验。
4. **M-06**：金库分账改容错（`pendingTreasury`），不要让 treasury 的可用性阻塞五条主路径。
5. **M-04**：`buyMiner` 成交前复检 `ownerOf` + approve，失败时清理挂单。
6. **M-02**：好友费改到 `acceptFriend` 按当时计数双向收费（或按累计第 11 个起收费）。
7. **M-01**：`setBaseURI` 改为 owner 可调并在 renounce 前显式设置；或复活 `_portrait` 做链上回落；同时安排海报随铸造生成。
8. **M-05**：`handlesBatch` 加 200 上限与 `nextId` 边界收敛。

### 建议同批修（不阻断，但成本极低）

`L-01` SafeCast、`L-02` 禁止自出价、`L-03` 只记实际分配量、`L-06` 删除 `.testkey` 与去掉部署回退、`L-09` 前端整数校验、`I-01` 修正 P 公式/发行速率注释、`I-03` 更新 AUDIT.md 的范围与结论。
