# FRENZO / Agent City — 全量安全审计报告 v3

**审计对象**：`contracts/CityCore.sol`（1037 行）、`contracts/MinerNFT.sol`（331 行）、`contracts/AgentToken.sol`（55 行）、`contracts/MockRegistry.sol`（15 行）、`contracts/FrenzoMultiSig.sol`（231 行）、`scripts/deploy.js`、`scripts/deploy-final.js`、`scripts/deploy-multisig*.js`、`scripts/ms.js`、`scripts/confirm-multisig.js`、`scripts/test-ms-rotation.js`

**审计日期**：2026-10-31

**审计方式**：全量源码逐行复核（非增量 diff）+ 本地重编译 + BSC 测试网实测状态核对

**基线与证据**

- 编译：`node scripts/compile.js` → 成功，无 error；`CityCore` 运行时 18,013 bytes（EIP-170 上限 24,576）
- 链上实测（chainId 97，`CityCore 0x1a5c15Ce675F48EF02991870E8B780DF7cbc06c0`）：
  `owner = 0xd11fBA8048B8fCE0E1C29191639551d4E1009A13`、`treasury = 0xA877D3B0...C460`、`router = 0x0`、`WBNB = 0x0`、`minerCount = 12`、`totalFriendUnits = 28`、`balance = 750000000000000`、`totalKeyValue = 750000000000000`、`spareBnb = 0`、`ms.required/ownerCount = 2/3`、`ms.txCount = 0`
- 已存在的历史报告 `AUDIT.md` / `AUDIT-v2.md` 中的结论**不作为本次依据**，全部重新验证。
- **可复现 PoC**：`scripts/poc-audit-v3.js`（本地 ganache，不触网）→ `node scripts/poc-audit-v3.js` → **8 通过 / 0 失败，exit 0**，实测复现 H-01 与 C-02：

```
━━ H-01  acceptFriend 可被重复确认 ━━
  minerA=1  minerB=2  初始 totalFriendUnits=2
  A 先连发 3 条 requestFriend（此时 pair 仍为 false，全部通过）: 1,2,3
  接受了 3 次（每次都各 +1/+1，units +2）
  minerA.friends = 3   minerB.friends = 3   totalFriendUnits = 8
  真实好友边 = 1 条
  ✓ PASS friends 被重复累加（应恒为 1）  friends=3
  ✓ PASS totalFriendUnits 被重复累加（应恒为 2）  units=8
━━ H-01  删除好友也无法回收多出来的单位 ━━
  removeFriend 一次后：friends = 2  totalFriendUnits = 6
  ✓ PASS 再删一次被拒绝（pair 已 false）
  ✓ PASS 残留的虚假好友单位永久留在链上  残留 2 单位 / total 6
━━ C-02  spareBnb 把用户出价托管当成闲置资金 ━━
  受害者出价 1 BNB（托管在合约里）
  core.balance   = 1.000125 BNB
  totalKeyValue  = 0.000125 BNB
  spareBnb()     = 1.0 BNB   <-- 全部是受害者的出价
  ✓ PASS spareBnb 把 100% 的出价托管算成可花余额
  路人调用 buybackAndBurn(spareBnb, minTokensOut=0)
  合约余额 1.000125 -> 0.000125 BNB
  ✓ PASS 合约 BNB 被无许可调用者花掉
  ✓ PASS 受害者再也取不回出价（cancelOffer revert）
  ✓ PASS 受害者的钱实际进了 router（即攻击者）
结果：8 通过 / 0 失败
```

---

# 一、Critical

## C-01 核心合约 owner 私钥与 VPS root 口令明文落盘，既有多签/所有权结构可被一键接管

**文件:行号**

- `.testkey`（工作区根目录，66 字节，含完整 `0x` + 64 位十六进制私钥）
- `scripts/deploy.js:36-40`（无 `PRIVATE_KEY` 时回退读取 `.testkey`）
- `scripts/deploy-final.js:33`、`scripts/deploy-multisig.js:21`、`scripts/deploy-multisig-v2.js:19`、`scripts/confirm-multisig.js:18`（全部读同一文件）
- `scripts/deploy-final.js:25`（`HOST = "45.153.130.144", PASS = "***REDACTED***"`）
- `deployment-97.json:8`（`"deployer": "0xd11fBA8048B8fCE0E1C29191639551d4E1009A13"`）
- 无 `.gitignore`（工作区根目录不存在）

**问题**

`.testkey` 里的私钥对应地址 `0xd11fBA8048B8fCE0E1C29191639551d4E1009A13`，链上实测它就是 `CityCore.owner()`，同时也是 `AgentToken.owner()` 和 `MinerNFT.deployer()`。该文件与 3 个部署脚本同目录，且**没有任何 `.gitignore`**；`deploy-final.js` 还把生产 VPS 的 root 密码写死在源码里（同一文件内）。

**可利用场景**

拿到该目录（或任何一份仓库/压缩包/网盘备份，例如工作区里已存在的 `frenzo-site.zip`）的攻击者：

1. `CityCore.setTreasury(attacker)`（`CityCore.sol:224`）→ 此后 **100% 的铸造价、key 买卖手续费、二级市场 5%** 全部进攻击者地址。费用是"实时转出、不留合约"的（`_splitFee` `CityCore.sol:850-853`、`buyMiner` `936-938`、`acceptOffer` `1010-1013`），所以这是**持续现金流**，不是一次性。
2. `CityCore.setRouter(attackerRouter)` + `setWBNB(attackerToken)`（`716`、`755`）→ 打开 `buybackAndBurn`（默认 `router==0` 是关闭的），配合 C-02 清空合约里全部托管 BNB。
3. `CityCore.setRegistry(attackerRegistry)`（`230`）→ 令 `mintMiner` 的 `registry.ownerOfHandle` 永久返回 0，**阻断全部铸造**（`394`）。
4. `AgentToken.owner` 已无法再改 minter（`setMinter` 一次性，`AgentToken.sol:34`），但 `renounceOwnership` 仍可调用 → 制造"已放弃所有权"的假象。
5. VPS root 口令 → `/var/www/frenzo/deployment-local.json`、`nft/chain.json`（`deploy-final.js:144-145`）可被改写 → 前端**直接换掉合约地址**做钓鱼，攻击面从链上扩到全站用户。

**修复**

```solidity
// 1) 直接 renounce（首选）
//    core.renounceOwnership() + token.renounceOwnership()
//    注意：renounce 后 setRouter/setWBNB 永久不可调用 => buybackAndBurn 永久不可用，
//    若要做回购，必须在 renounce 之前先 setRouter/setWBNB。

// 2) 若必须保留 owner：owner 必须迁到多签（OZ Ownable 已内置 transferOwnership，
//    但要显式调用并补一个防误操作的入口）
function transferOwnership(address n) public override onlyOwner {
    require(n != address(0), "zero");
    _transferOwnership(n);
}
```

```bash
# 运维侧（立即执行）
rm -f .testkey testnet-wallets.json          # 先备份到离线介质，再删除
printf '.testkey\ntestnet-wallets.json\ndeployment-*.json\n.seed-keys\n' >> .gitignore
# 轮换：新 owner 私钥在离线机生成 -> 迁 owner -> 旧私钥 0xd11f...9A13 视为已泄露
# VPS：改 root 口令 + 禁密码登录 + 只留密钥登录；密码不得出现在任何脚本
```

> 顺带：`testnet-wallets.json` 含 18 个明文私钥；已逐把推导比对，其中**不包含** 3 个多签 owner（均 no match），所以多签本身没被同一把钥匙串洞穿——但这份文件同样必须清理。

---

## C-02 `buybackAndBurn` 花掉用户出价托管金：`spareBnb` 漏算 `bestOffer` + `refundCredit` 负债，且滑点参数对调用方完全开放

**文件:行号**

- `contracts/CityCore.sol:722-725`（`spareBnb`）
- `contracts/CityCore.sol:732-750`（`buybackAndBurn`；`741-743` 把调用方传入的 `minTokensOut` 原样交给 router）
- `contracts/CityCore.sol:857-865`（`_clearMarket` → `refundCredit`）
- `contracts/CityCore.sol:868-874`（`withdrawRefund`）
- `contracts/CityCore.sol:959-975`（`makeOffer` 托管）
- 文档假设：`SPEC.md:363-368`「资金 = 合约闲置 BNB（余额 − totalKeyValue）／硬约束：永远不能动 totalKeyValue」

**问题**

`spareBnb()` 的定义是 `balance - totalKeyValue`。但合约余额里除 key 兑付储备外，还托管着**两类用户资金**，两者都不进 `totalKeyValue`：

1. `bestOffer[id].amount` —— `makeOffer` 收进来的出价托管（`967`）；
2. `refundCredit[user]` —— 出价被作废后改记账的待提现余额（`862`，`withdrawRefund` `868`）。

因此 `spareBnb()` 恒等于 **出价托管 + 待提现 + 尘埃**。当前链上 `spareBnb == 0`、`bestOffer` 全空，所以是**待触发**状态；一旦有人挂出价，`spareBnb` 立刻被这笔出价撑起来。

同时 `minTokensOut` 是**调用方任意入参**（没有下限、没有 TWAP、没有 oracle 校验），任何人可调用（`732` 无 onlyOwner，`SPEC.md:362` 明确"任何人"）。

**可利用场景（PoC 已实测：`poc-audit-v3.js` 的 C-02 段，8/8 通过）**

```
前置：router/WBNB 已由 owner 设置（C-01 后攻击者可直接设；当前链上二者均为 0x0，功能关闭）
1. 受害者 V 先 makeOffer(id, 1 BNB)       -> 合约余额 +1 BNB，spareBnb() = 1 BNB（实测）
2. 攻击者在 Pancake 上把 FRNZ 价格拉高（自有资金买入）
3. 攻击者（任意路人，无需权限）调 buybackAndBurn(1 BNB, minTokensOut = 0)
   -> 合约在**被拉高的价格**上把 1 BNB 换出去，然后 token.burn(got)（746）
   实测：合约余额 1.000125 -> 0.000125 BNB，钱进 router（= 攻击者）
4. 攻击者卖出手里提前买好的 FRNZ  -> 拿回 1 BNB + 溢价
5. 受害者调 cancelOffer(id)（978）或 withdrawRefund()（868）-> 合约余额不足 -> revert TransferFailed，
   实测 revert，资金永久锁死
```

- 直接后果（无需夹子）：**`refundCredit` 变成无准备金的白条**。任一人调用 `buybackAndBurn(spareBnb())` 即可让所有待提现用户永久取不到钱。
- 带夹子后果：钱从"受害者托管"平移成"攻击者利润"，`totalBurned` 只增加了一堆被拉高价格买来的空气。

**修复**

```solidity
// 新增两个全局负债量
uint256 public escrowedOffers;      // 出价托管总额
uint256 public totalRefundCredit;   // 待提现总额

/// @notice 合约里「超出所有负债」的闲置 BNB
function spareBnb() public view returns (uint256) {
    uint256 bal = address(this).balance;
    uint256 locked = totalKeyValue + escrowedOffers + totalRefundCredit;
    return bal > locked ? bal - locked : 0;
}

// makeOffer 里维护
escrowedOffers += msg.value - cur.amount;

// _clearMarket 同步维护
function _clearMarket(uint256 id) private {
    delete listings[id];
    Offer memory o = bestOffer[id];
    if (o.amount > 0) {
        delete bestOffer[id];
        escrowedOffers -= o.amount;
        refundCredit[o.buyer] += o.amount;
        totalRefundCredit += o.amount;
        emit OfferRefunded(id, o.buyer, o.amount);
    }
}

// withdrawRefund 里维护
totalRefundCredit -= amt;

// buybackAndBurn：滑点下限不能由调用方定
uint256 public minBuybackOutBps = 9_500;   // 至少拿到报价的 95%
function buybackAndBurn(uint256 bnbIn, uint256 minTokensOut) external nonReentrant {
    if (router == address(0)) revert RouterNotSet();
    if (bnbIn == 0) revert ZeroAmount();
    if (bnbIn > spareBnb()) revert TooMuchBnb();

    address[] memory path = new address[](2);
    path[0] = WBNB;
    path[1] = address(token);

    uint256[] memory quote = IRouter(router).getAmountsOut(bnbIn, path);
    uint256 floor = (quote[1] * minBuybackOutBps) / 10_000;
    if (minTokensOut < floor) minTokensOut = floor;

    uint256[] memory outs = IRouter(router).swapExactETHForTokens{value: bnbIn}(
        minTokensOut, path, address(this), block.timestamp + 600
    );
    ...
}
```

> 备选（更稳）：把回购改成 `onlyOwner`，`minTokensOut` 由多签提案传入，彻底消灭无许可夹子面。若坚持"任何人可触发"，上述报价下限是必需的。

---

# 二、High

## H-01 `acceptFriend` 缺"重复请求"校验，同一对矿机可被重复确认，永久抬升好友单位（30% 全网产出被抽走）

**文件:行号**

- `contracts/CityCore.sol:792-804`（`requestFriend` 只挡"已建立的好友关系"，不挡"未处理的重复请求"）
- `contracts/CityCore.sol:809-833`（`acceptFriend`：`827-830` 无 `_friendPairs` 复查就把 `friends += 1`、`totalFriendUnits += 2`）
- 对照 `contracts/CityCore.sol:764-779`（`removeFriend` 每次只减 1，且把 pair 置 false）

**问题**

`requestFriend` 的去重条件是 `if (_friendPairs[_pairKey(fromId, toMiner)]) revert AlreadyFriends();`（`798`）——只看**已建立**关系，不看 **pending 请求**。`acceptFriend` 里也没有 `if (_friendPairs[...]) revert AlreadyFriends();` 复查（`809-833` 全函数无此判断）。于是同一对矿机 (A,B) 可以存在 N 条 active 请求，每条被接受一次就各自 `friends += 1 / += 1 / totalFriendUnits += 2`。

`removeFriend` 只能把 `_friendPairs` 这个 bool 置一次 false、各减 1（`773-776`），多出来的计数**无法回收**（再调 `removeFriend` 会因 `NotFriendPair` revert，`768`）。

**可利用场景（PoC 已实测，见报告头 `poc-audit-v3.js` 输出）**

```
1. 攻击者控制 2 台矿机 A=id1、B=id2（两个自己控制的地址）
2. **先**把 N 条请求全部发出去（此时 pair 仍为 false，requestFriend 全部放行）
   A 连发 10 次 requestFriend(id2) -> 10 条 active 请求，成本仅 gas
   （顺序是关键：关系一旦建立，再 requestFriend 会被 AlreadyFriends 挡住）
3. B 依次 acceptFriend(1..10)
   每次：_settle 后 fm.friends+1、tm.friends+1、totalFriendUnits+2
   前 10 次因 fm.friends < FRIEND_FREE(10) 完全免费，第 11 次起每边 burn 1e18
4. 结果：A、B 各自 friends = 10，而真实好友关系只有 1 条
   -> 攻击者两台矿机在 30% 好友池里占 11/(Σ+20) 的权重，且永久无法回落
```

实测（N=3）：`friends = 3/3`、`totalFriendUnits = 8`，真实好友边 1 条；`removeFriend` 一次后仍残留 `friends = 2`、`totalFriendUnits = 6`，**多出来的 2 个单位永久锁死**。

链上现状 `totalFriendUnits = 28 = 12 + 8×2`，说明**该漏洞尚未被利用**，但它是无许可、可脚本化、成本极低的。

> 注意：本漏洞**不破坏** `Σ(friends+1) == totalFriendUnits`（两侧同步膨胀），破坏的是"friends 与真实好友边数一致"这一语义不变量。因此单看 I-1 是看不出来的。

**修复**

```solidity
// 1) requestFriend 增加 pending 去重：同一对矿机只允许一条 active 请求
mapping(bytes32 => uint256) public activeReqOf;   // pairKey => reqId(0 表示无)

function requestFriend(uint256 toMiner) external nonReentrant returns (uint256 reqId) {
    uint256 fromId = minerOf[msg.sender];
    if (fromId == 0) revert NoMiner();
    Miner storage tm = miners[toMiner];
    if (!tm.exists) revert NoMiner();
    if (fromId == toMiner) revert SelfFriend();
    bytes32 k = _pairKey(fromId, toMiner);
    if (_friendPairs[k]) revert AlreadyFriends();
    if (activeReqOf[k] != 0) revert AlreadyRequested();   // 新增错误

    reqId = ++nextReqId;
    friendReqs[reqId] = FriendReq({from: fromId, to: toMiner, toOwner: tm.owner, active: true});
    activeReqOf[k] = reqId;
    emit FriendRequested(reqId, fromId, toMiner);
}

// 2) acceptFriend 再补一道幂等闸（防历史遗留 pending + 防未来新增路径）
function acceptFriend(uint256 reqId) external nonReentrant {
    FriendReq storage r = friendReqs[reqId];
    if (!r.active) revert InactiveRequest();
    if (msg.sender != r.toOwner) revert NotTarget();
    r.active = false;

    bytes32 k = _pairKey(r.from, r.to);
    if (_friendPairs[k]) revert AlreadyFriends();          // 关键新增
    activeReqOf[k] = 0;
    ...
}
```

---

## H-02 多签 `confirmations` 计数器不随 owner 轮换清理：一轮轮换后，**单个** owner 即可执行任意提案

**文件:行号**

- `contracts/FrenzoMultiSig.sol:116-118`（`confirmed[txId][msg.sender] = true; t.confirmations += 1;`）
- `contracts/FrenzoMultiSig.sol:162-177`（`removeOwner`，不动任何 `confirmed` / `confirmations`）
- `contracts/FrenzoMultiSig.sol:180-192`（`replaceOwner`，同上）
- `contracts/FrenzoMultiSig.sol:133-148`（`execute` 只看 `t.confirmations >= required`）
- 对照 `contracts/FrenzoMultiSig.sol:207-217`（`getConfirmations` 只数**当前** owner）

**问题**

`t.confirmations` 是一个裸计数器，只加不减（除 `revoke`）。`removeOwner` / `replaceOwner` 既不清 `confirmed[txId][oldOwner]`，也不从所有在途提案里减掉该 owner 的票。于是"已离职 owner 的签名"永久计入任何它当年确认过的提案。而 `getConfirmations()` 只遍历当前 `owners` —— **UI/脚本显示 1/2，合约内部认为 2/2**，这个不一致正是漏洞的可观测指纹（`ms.js:54-55` 与 `92-94` 都用 `getConfirmations`，会给出错误的票数提示）。

**可利用场景**

```
配置 2-of-3 = {A,B,C}
1. A 调 submit(to=attacker, value=全部余额)          -> #0: confirmations = 1（A 的票）
2. 走合法流程轮换 A（丢钥匙场景，SPEC.md:345 明确支持）：
   B submit(addr(this), 0, replaceOwner(A,D))  -> #1: confirmations = 1
   C confirm(#1)                                -> #1: confirmations = 2
   任何人 execute(#1)                            -> owner 集合变成 {D,B,C}，但 #0 仍记着 A 的 1 票
3. D 调 confirm(#0)                                -> #0.confirmations = 2
   任何人 execute(#0) -> 成功把国库全部余额转给 attacker
   （当前 owner 里只有 D 真的签了；B、C 从未同意这笔转账）
```

即：**一次 owner 轮换 = 阈值从 2 降为 1**。丢一把钥匙后走 `replaceOwner` 是文档推荐动作，因此这是"按文档操作就会踩到"的路径。

**修复**

```solidity
// 方案 A（最小改动）：轮换时作废该 owner 在所有在途提案里的票
function _purgeOwnerVotes(address o) private {
    uint256 n = txCount;
    for (uint256 id = 0; id < n; id++) {
        if (confirmed[id][o]) {
            confirmed[id][o] = false;
            if (!txs[id].executed && txs[id].confirmations > 0) {
                txs[id].confirmations -= 1;
            }
        }
    }
}
function removeOwner(address o) external onlySelf {
    ...
    _purgeOwnerVotes(o);   // 加在 ownerCount -= 1 之前
    ownerCount -= 1;
}
function replaceOwner(address oldOwner, address newOwner) external onlySelf {
    ...
    _purgeOwnerVotes(oldOwner);   // 同上
}

// 方案 B（推荐，彻底去掉计数器）：执行时实时统计"当前 owner"的票
function _liveConfirmations(uint256 txId) private view returns (uint256 n) {
    uint256 len = owners.length;
    for (uint256 i = 0; i < len; i++) if (confirmed[txId][owners[i]]) n++;
}
function execute(uint256 txId) external {
    Tx storage t = txs[txId];
    if (t.proposedAt == 0) revert TxNotExist();
    if (t.executed) revert AlreadyExecuted();
    if (_liveConfirmations(txId) < required) revert NotEnoughConfirmations();   // 关键
    ...
}
```

> 同时建议加 `if (t.proposedAt + PROPOSAL_TTL < block.timestamp) revert TxExpired();`（见 L-02），避免"半年前的老提案 + 今天的轮换"组合。

---

## H-03 `_splitFee` 用 push 方式给 miner owner 打 BNB：owner 若是拒收 BNB 的合约，该矿机的 key 买卖被永久卡死（持有人无法卖出）

**文件:行号**

- `contracts/CityCore.sol:840-854`（`creator.call{value: toCreator}`，失败即 `revert TransferFailed`）
- `contracts/CityCore.sol:477`（`buyShares` 调 `_splitFee(fee, m.owner)`）
- `contracts/CityCore.sol:516`（`sellShares` 调 `_splitFee(fee, m.owner)`）
- 同类：`contracts/CityCore.sol:933`（`buyMiner` 打给 seller）、`1008`（`acceptOffer` 打给 seller）

**问题**

任何调用栈只要把 BNB **推**给一个不实现 `receive()` / `fallback()` 的合约地址，`.call{value:}` 就返回 false → `revert TransferFailed()`。`m.owner` 是 NFT 所有者，可以是任意合约（金库合约、聚合器托管合约、未实现 payable fallback 的业务合约）。一旦某个矿机的主人变成这类合约，该矿机的 `buyShares` 和 `sellShares` **全局失败**——受害者不是 owner，而是**所有持有该矿机 key 的用户**（他们再也卖不掉，只能等 `claim`）。`claim` 不经过 `_splitFee`，所以资金不会全损，但流动性被锁死。

（`sellShares` 里 `_splitFee` 只在 `fee > 0` 时触发，`516`；对任何有实际成交额的交易都成立。）

**可利用场景**

```
1. 任何一次 NFT 转让把矿机交给"拒收 BNB 的合约"（例如未实现 receive 的金库合约
   或某聚合器的托管合约）——转让本身成功，问题在这之后的每次交易
2. 此后该矿机 key 市场的买卖两侧全部 revert：
   - buyShares(453) -> _settle -> ... -> _splitFee(477) -> creator.call 失败 -> revert
   - sellShares(489) -> _splitFee(516) -> 同上 -> revert
3. 已持有 key 的用户无法 sellShares，价格发现完全消失，只能 claim 挖矿产出
```

**修复**

```solidity
// 改成 pull 模式：记账 + 用户自提，谁也不能因为拒收而拖垮市场
mapping(address => uint256) public creatorCredit;

function _splitFee(uint256 fee, address creator) private {
    uint256 toCreator = (fee * CREATOR_FEE_BPS) / 10_000;
    uint256 toTreasury = fee - toCreator;

    if (toCreator > 0 && creator != address(0)) {
        creatorCredit[creator] += toCreator;        // 不 push，不 revert
    } else {
        toTreasury += toCreator;
    }
    if (toTreasury > 0) {
        (bool ok2, ) = treasury.call{value: toTreasury}("");
        if (!ok2) revert TransferFailed();           // treasury 是自家多签，仍可硬失败
    }
}

function withdrawCreatorCredit() external nonReentrant {
    uint256 amt = creatorCredit[msg.sender];
    if (amt == 0) revert ZeroAmount();
    creatorCredit[msg.sender] = 0;
    (bool ok, ) = msg.sender.call{value: amt}("");
    if (!ok) revert TransferFailed();
}
```

> `buyMiner`（933）/`acceptOffer`（1008）给 seller 的付款同理建议改 pull，或至少接受"卖家自己拒收只影响自己"这一现状并在文档写明。

---

# 三、Medium

## M-01 部署脚本的 treasury 指向单人 EOA，与 `SPEC.md` 宣称的 2-of-3 多签矛盾

**文件:行号**：`scripts/deploy.js:20`（`const TREASURY = "0x8fa19dc45590c44ae81262c0a79b2f81a941df6a";`）、`scripts/deploy.js:101-106`（作为构造参数）、`scripts/deploy-final.js:27,73`（事后再 `setTreasury(MULTISIG)`）；对照 `SPEC.md:307`、`SPEC.md:327`

**问题**

`deploy.js` 头部注释自己就是推荐部署路径（`deploy.js:1-8`），而它把 treasury 写死为 `0x8fa19dc4...df6a`。链上实测该地址 `getCode` 长度为 0（**EOA**），余额 0.0288 BNB。真正的多签 `0xA877D3B0...C460` 只在 `deploy-final.js` 里事后补一刀。若只跑 `deploy.js`（或其第 3 步失败），所有费用永久进这个 EOA，与"国库是 2-of-3 多签"的对外声明直接冲突。

**修复**

```js
// deploy.js:20 —— 去掉 EOA，改成必须显式传入
const TREASURY = process.env.TREASURY || "";
if (!ethers.isAddress(TREASURY)) throw new Error("必须显式提供 TREASURY=多签地址");
// 并在 deploy 后立刻断言
if ((await core.treasury()).toLowerCase() !== TREASURY.toLowerCase()) throw new Error("treasury 未生效");
```

## M-02 多签地址在 4 个脚本里三套不一致，且校验脚本会把错地址写回配置

**文件:行号**：`scripts/confirm-multisig.js:7`（`0xc31e999A15e3EC899C9755dAdF4b4F665E5E22dc`）、`scripts/confirm-multisig.js:31-34`（**无条件**把该地址写入 `deployment-97.json`）、`scripts/deploy-final.js:27`（`0xA877D3B0...`）、`deployment-97.json:7,10`（`0xA877D3B0...`）、`scripts/deploy-multisig.js:59` / `deploy-multisig-v2.js:44`（每次跑都部署**新**多签并切过去）

**问题**

`confirm-multisig.js` 硬编码 `0xc31e...`，与链上真实的 `treasury`（`0xA877...`）不同；它第 23 行会打印 ✗，但第 31-34 行仍把 `0xc31e...` 覆盖写进 `deployment-97.json`。之后 `ms.js`（`ms.js:22` 读 `cfg.multisig`）就会对着一个**错误的、可能 owner 未知的**多签做操作；`deploy-multisig*.js` 每次运行还会再生成一个新多签并把 treasury 切过去，旧多签里的余额需再用旧多签提出（`deploy-multisig-v2.js:53-54` 自己也提示了）。

**修复**

```js
// 一切从链上读，禁止在脚本里硬编码地址
const core = new ethers.Contract(cfg.core, coreAbi, p);
const MS = await core.treasury();                 // 唯一真相源
const onchainOwners = await new ethers.Contract(MS, msAbi, p).getOwners();
// 只读 + 断言，不做写入
if (cfg.multisig && cfg.multisig.toLowerCase() !== MS.toLowerCase())
  throw new Error(`配置漂移: cfg=${cfg.multisig} chain=${MS}`);
```

## M-03 `_accrue` 在池子为空时把产出计入 `totalMined` 却不分配，产出永久蒸发

**文件:行号**：`contracts/CityCore.sol:530-548`（`537` 无条件 `totalMined += reward`，而 `540-545` 只在池子非空时分配）、`contracts/CityCore.sol:550-567`（`pendingOf` 同样逻辑）

**问题**

部署后到第一台矿机之间（`lastUpdate` 在构造时设定，`219`），任何人调 `accrue()`（`526`，无许可）都会把这段时间的 `REWARD_PER_SEC × dt` 记进 `totalMined`，而 `totalFriendUnits == 0` → 30% 好友池直接丢弃；`totalKeyValue == 0` → 70% key 池直接丢弃。被丢弃的部分**永远不会被铸造**（`cap = MAX_SUPPLY - totalMined`，`534`），属于永久性产出损失。当前链上 `totalMined = 1373.03 FRNZ`、`token.totalSupply = 0`，说明"计入但未铸造"的差值已经在累积（本身正常，但同一机制也会吞掉空池子窗口的产出）。

**修复**

```solidity
function _accrue() private {
    uint256 dt = block.timestamp - lastUpdate;
    if (dt == 0) return;
    uint256 reward = REWARD_PER_SEC * dt;
    uint256 cap = MAX_SUPPLY - totalMined;
    if (reward > cap) reward = cap;

    uint256 friendPool = (reward * 3_000) / 10_000;
    uint256 keyPool = reward - friendPool;
    uint256 used;
    if (totalFriendUnits > 0) { accFriendPerUnit += Math.mulDiv(friendPool, 1e18, totalFriendUnits); used += friendPool; }
    if (totalKeyValue  > 0)  { accKeyPerValue   += Math.mulDiv(keyPool,   1e18, totalKeyValue);   used += keyPool;   }
    totalMined += used;          // 只记真正分配出去的
    lastUpdate = block.timestamp;
}
```

## M-04 群组绑定"创建者的当前矿机"，创建者卖出矿机后群组永久无法加入

**文件:行号**：`contracts/CityCore.sol:658-671`（`664` `minerOf[groups[gid].creator]`、`665` `if (myId == 0 || creatorId == 0) revert NoMiner();`）、`contracts/CityCore.sol:876-889`（`881` 转让时 `delete minerOf[from]`）、`674-688`（`leaveGroup` 用 `groups[gid].creator == msg.sender` 判断）

**问题**

`joinGroup` 用 `minerOf[creator]` 反查创建者的矿机 id 来做好友校验。创建者一旦把矿机转出，`minerOf[creator] == 0` → `creatorId == 0` → **该群组对所有人永久不可加入**（`665` 直接 revert）。同时 `leaveGroup` 只按地址判定创建者（`676`），创建者身份不随矿机转移，也不可转让，群组无 owner 迁移路径。`groupOf` 同样绑定地址（`630`），创建者卖出矿机后用原地址重新铸造也无法再建群（`643`）。

**修复**

```solidity
// Group 里记录创建时的矿机 id，并在创建者离场时允许接管
struct Group { string name; address creator; uint256 creatorMinerId; uint256 createdAt; bool exists; }

function joinGroup(uint256 gid) external {
    Group storage g = groups[gid];
    if (!g.exists) revert NoGroup();
    if (isGroupMember[gid][msg.sender]) revert AlreadyMember();

    uint256 myId = minerOf[msg.sender];
    if (myId == 0) revert NoMiner();

    uint256 creatorId = minerOf[g.creator];
    if (creatorId == 0) {
        // 创建者已不持有矿机 -> 退化为"与任一现有成员为好友即可加入"
        bool ok;
        address[] storage ms = _groupMembers[gid];
        for (uint256 i = 0; i < ms.length; i++) {
            uint256 mid = minerOf[ms[i]];
            if (mid != 0 && _friendPairs[_pairKey(myId, mid)]) { ok = true; break; }
        }
        if (!ok) revert NotFriend();
    } else if (!_friendPairs[_pairKey(myId, creatorId)]) {
        revert NotFriend();
    }
    ...
}
```

## M-05 `MockRegistry.set` 无任何权限，测试网上"持有 .ai"校验形同虚设

**文件:行号**：`contracts/MockRegistry.sol:8-10`（`set` 无 modifier）、`contracts/CityCore.sol:394`（唯一的身份校验 `registry.ownerOfHandle(handle) != msg.sender`）

**问题**

链上 `registry = 0xdf9Ac197...BE21` 就是 MockRegistry（`deployment-97.json:6`），`set()` 无权限。任何人可 `set("vitalik", 自己)` 然后 `mintMiner("vitalik")` —— handle 与地址的绑定完全可伪造。`MinerNFT.handleUsed`（`MinerNFT.sol:60-61`）只能防"同一 handle 被铸两次"，防不了"handle 被别人冒名铸造"。前端 `/nft/chain.json` 指向的正是这条链，因此测试网上展示的矿机 handle 可被任意冒用。

**修复**

```solidity
// 仅用于测试，但至少加一层权限 + 切换主网的真实断言
contract MockRegistry {
    mapping(string => address) public owners;
    address public immutable admin;
    constructor() { admin = msg.sender; }
    function set(string calldata h, address a) external { if (msg.sender != admin) revert(); owners[h] = a; }
}
```

> 上线主网时 `deploy.js:92-99` 会自动换 `AGENT_ID_MAINNET 0x60B92624...22F`，但**没有任何测试验证该合约的返回语义**（只知道能调用），见 M-09。

## M-06 `makeOffer` 的前任出价人若拒收 BNB，该矿机的出价/撤单/成交路径全部失效，资金锁死

**文件:行号**：`contracts/CityCore.sol:959-975`（`970-973` 退上一手，失败即 revert）、`978-985`（`cancelOffer` 同样是 push）

**问题**

`makeOffer` 把上一手全额 `.call{value}` 退回；`cancelOffer` 也 push。若某出价人是拒收 BNB 的合约，则：

1. 该矿机**所有后续出价**全部 revert（`972`）→ 市场死掉；
2. 该出价人自己也无法 `cancelOffer`（`983`）→ 这笔 BNB 永久锁在合约里；
3. 这笔锁定 BNB 又被 `spareBnb()` 视为闲置（C-02）→ 会被回购抽走。

**修复**

```solidity
function makeOffer(uint256 id) external payable nonReentrant {
    ...
    Offer memory cur = bestOffer[id];
    if (msg.value <= cur.amount) revert OfferTooLow();
    bestOffer[id] = Offer({buyer: msg.sender, amount: uint96(msg.value)});
    escrowedOffers += msg.value - cur.amount;

    if (cur.buyer != address(0) && cur.amount > 0) {
        (bool ok, ) = cur.buyer.call{value: cur.amount}("");
        if (!ok) {                                  // 退不回去就记账，绝不挡住市场
            refundCredit[cur.buyer] += cur.amount;
            totalRefundCredit += cur.amount;
            emit OfferRefunded(id, cur.buyer, cur.amount);
        }
    }
    emit OfferMade(id, msg.sender, msg.value);
}
```

## M-07 NFT 元数据完全依赖单点域名，`setBaseURI` 无调用入口（不可修复的中心化）

**文件:行号**：`contracts/MinerNFT.sol:283-284`（`baseImageURI = "https://frenzo.tech/nft/poster/"`、`baseViewerURI = "https://frenzo.tech/viewer/?id="`）、`286-290`（`setBaseURI` 是 `onlyCore`，而 `CityCore` 里**没有任何函数**调用它）、`292-309`（`tokenURI` 拼外部 URL）、`139-239`（`_portrait` 链上立绘**从未被调用**）

**问题**

`tokenURI` 返回的 `image` / `animation_url` 是 `frenzo.tech` 上的外部资源；`setBaseURI` 只能由 core 调用，而 core 没有对应入口 → **这两个 URI 永久不可更改**。域名到期/被墙/换主机 → 整系列 NFT 的图片与动画全部 404，且链上无法补救。同时 `_portrait()`（约 100 行纯链上 SVG 生成）和 `SKIN/SKIN_DARK/HAIR/OUTFIT/BG`（`88-92`，5 个 storage string 数组）是死代码，只在部署时消耗 gas。

**修复**

```solidity
// 方案 A：把 _portrait 接回去做兜底（图片自托管在链上）
function tokenURI(uint256 id) public view override returns (string memory) {
    _requireOwned(id);
    string memory svg = Base64.encode(bytes(_portrait(id, handleOf[id])));
    string memory json = Base64.encode(bytes(string.concat(
        '{"name":"', handleOf[id], '.ai Miner #', id.toString(),
        '","image":"data:image/svg+xml;base64,', svg, '",',
        '"attributes":', traitJson(id), '}')));
    return string.concat("data:application/json;base64,", json);
}
// 方案 B：保留外部 URL，但给 core 加一个合法的改 URI 入口
//   CityCore: function setNftBaseURI(string calldata img, string calldata v) external onlyOwner
//   => { nft.setBaseURI(img, v); }
//   并删掉死代码 _portrait / SKIN* / HAIR / OUTFIT / BG（省部署 gas，也为 EIP-170 留余量）
```

## M-08 种子矿机私钥不落盘，12 台矿机永久不可转移、收益永久不可领取

**文件:行号**：`scripts/deploy-final.js:84`（`ethers.Wallet.createRandom()`）、`85-91`（只 push 进内存数组 `wallets`，脚本结束即丢失）、`90`（用这些钱包 `mintMiner`）

**问题**

12 台种子矿机（链上 `minerCount = 12`、`nextId = 13`）由 `createRandom()` 生成的钱包铸造，私钥从未写入任何文件（对照 `testnet-wallets.json` 里的 18 把旧私钥，那是历史脚本手动落盘的）。脚本退出后这 12 个地址的私钥不可恢复 → 对应 NFT 不可转移（`minerOf` 永挂在这些地址上）、`ownerPending` 不可 claim、好友/群组不可操作。这些矿机变成**只读装饰**，并且永久占用 12 个 `totalFriendUnits` 单位（`+12`），稀释所有真实用户的产出。

**修复**

```js
// 生成后立刻加密落盘（或从确定性种子派生），并在 deployment-*.json 记录地址
const walletsJson = [];
for (let i = 0; i < SEED; i++) {
  const c = ethers.Wallet.createRandom().connect(p);
  walletsJson.push({ i, address: c.address, privateKey: c.privateKey });
  ...
}
// 写到仓库外 + 加密：fs.writeFileSync(process.env.SEED_KEYS_FILE, JSON.stringify(walletsJson));
// 文件权限 600，且必须进 .gitignore
```

## M-09 `registry` 冒烟检查只验证"函数能调用"，不验证返回语义

**文件:行号**：`scripts/deploy.js:115-136`（`124` 用随机 handle 调 `ownerOfHandle`，只要不 revert 就 `ok = true`）、`127-135`（失败时保留所有权并 `exit(2)`）

**问题**

`ownerOfHandle("frenzo-probe-" + Date.now())` 对 MockRegistry 永远返回 `address(0)` 且成功，对真实的 AgentID 也可能返回 0 而不 revert。这个"冒烟"只能发现 ABI 拼错，发现不了：主网注册表返回 `bytes32` 而非 `address`、或 handle 需要带 `.ai` 后缀、或该函数需要 gas/是 non-view。一旦上线才发现，`mintMiner` 全链路 revert（`394`），而 `setRegistry` 是 `onlyOwner`（`230`）——若已 renounce 就永久修不了。

**修复**

```js
// 用真实存在的 handle 做端到端断言（部署前由运营提供 1 个已知 handle + 其 owner）
const KNOWN_HANDLE = process.env.KNOWN_HANDLE;         // 例如 "frenzo"
const KNOWN_OWNER  = process.env.KNOWN_OWNER;
if (!KNOWN_HANDLE || !KNOWN_OWNER || !ethers.isAddress(KNOWN_OWNER))
  throw new Error("必须提供 KNOWN_HANDLE / KNOWN_OWNER 才能验证 registry 语义");
const got = await regProbe.ownerOfHandle(KNOWN_HANDLE);
if (got.toLowerCase() !== KNOWN_OWNER.toLowerCase())
  throw new Error(`registry 语义不符: ${KNOWN_HANDLE} -> ${got}, 期望 ${KNOWN_OWNER}`);
```

---

# 四、Low

## L-01 `uint96` 静默截断（挂单价 / 出价）

**文件:行号**：`contracts/CityCore.sol:904`（`price: uint96(price)`）、`contracts/CityCore.sol:967`（`amount: uint96(msg.value)`）

显式窄化转换在 0.8 里**不 revert 而是截断**。`listMiner(id, 2**96 + 1000)` 会以 1000 wei 上架（自伤）；`makeOffer` 需 > 7.9e28 wei（79 亿 BNB）才触发，实际不可达。仍建议显式校验，避免未来改成"由前端传价"时踩坑。

```solidity
if (price > type(uint96).max) revert PriceTooHigh();
listings[id] = Listing({seller: msg.sender, price: uint96(price), active: true});
```

## L-02 多签提案无过期时间，陈旧提案永久可执行

**文件:行号**：`contracts/FrenzoMultiSig.sol:96-103`（记了 `proposedAt` 但从未使用）、`133-148`

`proposedAt` 只写不读。叠加 H-02，一个半年前"两票齐全但没人执行"的提案可以在 owner 全部换过之后被任何人 `execute`。

```solidity
uint256 public constant PROPOSAL_TTL = 14 days;
if (block.timestamp > t.proposedAt + PROPOSAL_TTL) revert TxExpired();
```

## L-03 `acceptFriend` 用请求时的 `toOwner` 快照做授权，矿机易主后旧 owner 仍可代人同意

**文件:行号**：`contracts/CityCore.sol:801`（`toOwner: tm.owner` 写入快照）、`812`（`if (msg.sender != r.toOwner) revert NotTarget();`）、`881-885`（转让时 `m.owner` 与 `minerOf` 更新，但 `r.toOwner` 不变）

A 对 B 的矿机发请求后，B 把矿机卖给 C。此时 `r.toOwner` 仍是 B，B（已不持有该矿机）仍可 `acceptFriend` 完成一次不属于自己的关系变更，并触发 `token.burnFrom(tm.owner=C, 1e18)`（`823-824`）从 **C** 扣币。修复：授权改为实时校验 `require(msg.sender == miners[r.to].owner)`。

## L-04 部署脚本无幂等性、无备份，`deployment-97.json` 每次被覆盖

**文件:行号**：`scripts/deploy.js:163-164`（无条件覆盖写）、`scripts/deploy-final.js:44-50`（每次 `execSync` 重新部署全套）、`scripts/deploy-multisig-v2.js:26-31`（每次生成新多签）

`deploy-final.js` 每次运行都会产生 4 个新合约 + 12 台新矿机，旧地址只剩 `deployment-local.backup.json` 这种人工备份。建议：先读旧文件、存在则 `--force` 才覆盖，或按 `deployment-{chainId}-{timestamp}.json` 归档。

## L-05 构造函数不校验 `treasury_`

**文件:行号**：`contracts/CityCore.sol:213-222`（只校验 `token_` / `nft_`，`treasury = treasury_` 无检查）

若部署时传 `address(0)`，`treasury.call{value:}` 对零地址**成功**（EVM 层）→ 全部费用静默销毁。`scripts/deploy.js:51` 有一道 `TREASURY === ZeroAddress` 检查，但构造函数本身没兜底。

```solidity
require(treasury_ != address(0), "zero treasury");
require(registry_ != address(0), "zero registry");
```

## L-06 参数/文档漂移（用户与审计方会被误导）

| 位置 | 写的 | 实际 |
|---|---|---|
| `CityCore.sol:40-41` | 「份额买卖手续费 5%」 | `FEE_BPS = 1000` → **10%**（`43`） |
| `CityCore.sol:22` | 「买卖各 5% 手续费」 | 10%，其中 5% 给 owner、5% 进国库 |
| `CityCore.sol:48-55` | 「矿机主人基础分成 5% / 最大额外 15% / 上限 20%」 | `OWNER_BASE_BPS` / `OWNER_FRIEND_BPS` / `OWNER_MAX_BPS` **全部未被任何代码引用**（死常量） |
| `CityCore.sol:57` | 「每 1000 台 +0.0002 BNB」 | `BASE_MINT_PRICE = 0.0003`，每 1000 台 +0.0003（`60`、`292-294`） |
| `CityCore.sol:291` | 「1~1000 台 0.0002」 | 0.0003 |
| `CityCore.sol:410` | 「固定送 3 份 key」 | `MINT_KEYS = 2`（`63`） |
| `CONTRACTS.md:89-90` | 「5% 手续费进金库」 | 10%，且只有一半进金库 |
| `AgentToken.sol:9` | 「总量 10 亿」/「$ACT」 | `MAX_SUPPLY = 1e8`（`14`）、symbol `FRNZ`（`24`） |
| `CityCore.sol:19-20,255-259` | `P = 100×(1+0.3·ln(friends+1)/ln101+...)` | `_powerOf`（`269-278`）是**线性**权重，与对数无关；`_log2Fixed`（`242-253`）与 `LOG2_101`（`75`）、`VALUE_UNIT`（`78`）写好了但**从未被调用** |
| `SPEC.md:87` | 「权重 = (friends+1)/Σ(friends+1)」 | 与上面两者都不同（实际 30% 线性好友 + 70% 线性市值） |

> 结论：**同一个"算力/权重"概念在代码注释、`_powerOf` 实现、`SPEC.md` 里是三个不同公式**。这不影响资金安全（`_accrue` 的分账是自洽的），但属于对用户的核心信息披露失实，必须在 TGE 前统一。

## L-07 `burnTokens` 是死代码

**文件:行号**：`contracts/CityCore.sol:1026-1028`

`token.burnFrom(msg.sender, amount)` 需要 `msg.sender` 自己先给 CityCore 授权，等价于用户自己烧自己的币，没有任何协议语义。建议删除，或改成 `onlyOwner` 的真·平台回购入口。

## L-08 运行时体积已用掉 EIP-170 的 73%

`CityCore` 运行时 18,013 / 24,576 bytes。删掉 L-06 提到的死常量/死函数（`_log2Fixed`、`OWNER_*`、`LOG2_101`、`VALUE_UNIT`、`_portrait`、5 个调色板数组）可回收可观空间，为后续群组/回购功能留余量。

---

# 五、Info

1. **`onMinerTransfer` 的既有语义**：转让时**不结算** `ownerPending`，未领的主人收益归**买家**（`claim` 只认当前 `m.owner`，`CityCore.sol:599`）。`CityCore.sol:895` 的注释「成交时 NFT 与未释放收益一起转给买家」与实现一致，属**设计取舍**；但 `listMiner` 的注释（`903`「先把已产出的结清，避免卖家和买家纠纷」）与实现矛盾——`_settle` 只是把产出记账进 `ownerPending`，并没有付给卖家。**注释必须改**，否则卖家会误以为已结清。
2. **好友费的实际扣费对象**：`acceptFriend` 从 `fm.owner` / `tm.owner` 扣（`823-824`），请求时不预扣。若被请求方等到请求方好友数 ≥10 再接受，请求方会被"未经当时同意"地扣 1e18。属设计取舍，但建议在 `requestFriend` 时就锁定额度（escrow）或要求请求方预先 `approve` 并在 UI 明示。
3. **`burnFrom` 失败即 `acceptFriend` 永久失败**：请求方余额 < 1e18 或未授权 → `acceptFriend` 必 revert（`823`），请求永久无法完成。Low，建议 try/catch 降级为"不收费但也不建立关系"或允许双方确认时选择。
4. **`_groupMembers` 无上限**：`leaveGroup` 是 O(n) 线性扫描（`680-686`），`groupProfile` 是 O(groupCount) 全表扫描（`707-711`）。仅 view/前端，但群组数上千后前端会超 RPC gas 上限。
5. **`_log2Fixed` 精度**：注释写"误差 < 3%"（`241`），实测二次近似在 f→1 时误差约 2.4%，可接受；但该函数没人用。
6. **`compile.js` 未落 `deployedBytecode`、无 solc 版本钉扎**：`compile.js:76` 只写 `{abi, bytecode}`，`package.json` 用 `^0.8.24`，`viaIR: true`（`compile.js:30`）——审计方与链上字节码无法做确定性比对。建议落 `deployedBytecode` + `metadata` + 精确 solc 版本（0.8.24+commit.e11b9ed9）。
7. **`MinerNFT.burn` 不可达**：`onlyCore`（`69-71`），但 `CityCore` 从不调用它 → 矿机永不销毁。若将来接入 burn，须注意 `onMinerTransfer(id, from, 0)` 会把 `m.owner` 置 0 且 `exists` 仍为 true（`879-886`），该矿机的 key 持有人可继续按 `shareRevenue` 分 70% 池而无需任何 owner —— 需要在 burn 路径里同时清零 `shareRevenue` 并结算。
8. **`handlesBatch` 的 `from + count` 未做溢出保护**：`MinerNFT.sol:275`，`from = 2**256-1` 会 revert（可接受，只是不优雅）。
9. **`FrenzoMultiSig.execute` 的失败分支是死代码**：`140-147` 先 `t.executed = false` 再 `revert`，回滚后 `ExecutionFailure` 事件永不落链、`executed=false` 也是空操作。监控拿不到失败信号。

```solidity
// 修正：不 revert，只记事件（保持 executed=false 可重试）
t.executed = true;
(bool ok, ) = t.to.call{value: t.value}(t.data);
if (!ok) { t.executed = false; emit ExecutionFailure(txId); }
else emit Execution(txId, msg.sender);
```

10. **`FrenzoMultiSig` 构造函数允许 `address(this)` 成为 owner**（`73-86` 只排除 `address(0)`）。极端配置下等于把 `onlySelf` 的入口开给"任何一个拿到 1 票的人"。建议显式 `if (o == address(this)) revert InvalidOwners();`。
11. **`getConfirmations` 与 `confirmations` 语义分叉**（H-02 的可观测面），`ms.js:54-55` / `92-94` 都以 `getConfirmations` 为准，会在 H-02 场景里显示 `1/2` 并劝退攻击者——不能当作安全属性。
12. **`test-ms-rotation.js:65` 把错误行为写成了断言**：`ok("3→2 且阈值 2 时允许移除", !blocked)` —— 该用例实际证明了"可以把 owner 减到刚好等于阈值"，也就是 `SPEC.md:345`「丢钥匙不会锁死」的反例（2-of-2 之后丢任一把即永久冻结）。测试应当断言相反结果，或明确文档化该风险。

---

# 六、检查通过项（已逐项验证，无需重复排查）

## 6.1 新增功能专项

| 检查项 | 位置 | 结论 |
|---|---|---|
| `removeFriend` 计数下溢 | `764-779` | **通过**。`friends -= 1` / `totalFriendUnits -= 2` 由 0.8 检查算术保护，且只有 `_friendPairs == true` 才进入（`768`），此时两侧 `friends ≥ 1`、`totalFriendUnits ≥ 2`，下溢不可达 |
| `removeFriend` 重复删除 | `768, 773` | **通过**。删除后 `_friendPairs` 置 false，再调即 `revert NotFriendPair()` |
| `removeFriend` 自删 | `781-783` | **通过**。`_pairKey(a,a)` 永不为真（`requestFriend` 有 `SelfFriend` 校验，`797`） |
| `removeFriend` 结算顺序 | `770-776` | **通过**。先 `_settle` 双方（用变更前的 `friends` 计算历史产出），再减计数，无追溯性收益变更 |
| `removeFriend` 重入 | `764` | **通过**。函数体内无任何外部调用（`_settle` / `_accrue` 纯内部记账），无需 `nonReentrant` |
| `createGroup` 权限 | `641-655` | **通过**。要求 `minerOf != 0`，`groupOf` 防重复建群，`gid` 从 1 开始（`647`），名称长度 1..32 |
| `createGroup` / `joinGroup` / `leaveGroup` 数组操作 | `649-651, 668-670, 678-687` | **通过**。`leaveGroup` 用 swap-and-pop 且在 `break` 后立即终止，无越界；`isGroupMember` 与数组严格同步（加入前查重、退出后置 false），不会出现重复元素 |
| `leaveGroup` 越界 id | `674-676` | **通过**。不存在的 gid → `isGroupMember` false → `revert NotMember()` |
| `joinGroup` 权限 | `658-671` | **通过**（安全性）。必须自身有矿机 + 与创建者已建立好友关系，无法绕过；可用性问题见 M-04 |
| `_clearMarket` 重入 | `857-865` | **通过**。无外部调用，只做 `delete` + 记账；`onMinerTransfer` 内亦无外部调用 |
| `_clearMarket` 账目 | `859-864` | **通过**（就"不超发"而言）。`refundCredit += o.amount` 与 `makeOffer` 收进的 BNB 一一对应，不存在凭空记账；`acceptOffer` 先 `delete bestOffer`（`1000`）再 `transferFrom`（`1006`），hook 里看到 `amount == 0` 不会二次退款 |
| `_splitFee` creator 为零地址 | `844-849` | **通过**。`creator == address(0)` 或 `toCreator == 0` 时并入 `toTreasury`，不会卡死、不会丢币 |
| `_splitFee` 舍入 | `841-842` | **通过**。`toCreator` 向下取整，余数进国库，两侧之和恒等于 `fee` |
| `_splitFee` call 失败 | `845-846` | **通过**（按设计：失败即整笔 revert，不存在半结算）。由此产生的可用性问题见 H-03 |
| `buybackAndBurn` CEI | `732-750` | **通过**。有 `nonReentrant`，`totalBurned` 在 `burn` 之后累加，无重入面；资金侧问题见 C-02 |
| `buybackAndBurn` router 调用 | `741-743` | **通过**（格式正确）。`path[0]=WBNB, path[1]=token`、`to=address(this)`、`deadline=+600s`、`outs[last]` 取实际到账量 |
| `handlesBatch` 上限与边界 | `MinerNFT.sol:272-280` | **通过**。`count` 收敛到 200；`end = from + count` 为右开区间，`end > nextId` 时收敛到 `nextId`，因此实际返回 `id ∈ [from, nextId-1]`（合法 id 正是 `1..nextId-1`），`end <= from` 返回空数组，`from == 0` 归一到 1 |
| `minersBatch` 上限与边界 | `CityCore.sol:315-351` | **通过**。`count` 收敛 200；`from<1 → 1`；`end = from+count-1`；`n = end>=from ? end-from+1 : 0`（count=0 时安全返回空） |

## 6.2 重入

| 检查项 | 位置 | 结论 |
|---|---|---|
| 所有含外部调用的函数是否都有 `nonReentrant` | `390, 453, 489, 593, 732, 868, 897, 919, 959, 978, 991, 792, 809` | **通过**。13 处 `nonReentrant`，覆盖全部 `{value}` 收发、ERC721 转账、ERC20 mint/burnFrom 调用点 |
| 无锁函数是否真的安全 | `526 accrue`、`641 createGroup`、`658 joinGroup`、`674 leaveGroup`、`764 removeFriend`、`909 unlistMiner` | **通过**。六个函数体内均无外部调用（`accrue` 仅改累加器），不存在重入窗口 |
| 跨函数重入（在 `_splitFee` 回调里打别的入口） | `477 / 516 → 840` | **通过**。`_splitFee` 触发时 `m.supply` / `m.shareRevenue` / `totalKeyValue` / `shares` / `shareDebt` / `refundCredit` 均已落定（CEI 成立），且 `removeFriend` / `leaveGroup` / `unlistMiner` 即使被回调也只操作互不相干的状态 |
| `onMinerTransfer` 钩子的重入面 | `MinerNFT.sol:74-81` → `CityCore.sol:876-889` | **通过**。钩子在 `super._update` 之前调用，但函数体无外部调用；`AlreadyMiner` 校验在钩子里完成，失败会连带回滚整笔转账 |
| `buyShares` / `sellShares` 的 CEI | `469-477` / `507-517` | **通过**。状态（supply、shareRevenue、totalKeyValue、shares、shareDebt）全部在转账之前完成 |
| `withdrawRefund` / `cancelOffer` 的 CEI | `869-873` / `979-983` | **通过**。先清零再转账 |
| `FrenzoMultiSig.execute` 的重入 | `139-140` | **通过**。`t.executed = true` 在外部调用之前（CEI），重入会 `revert AlreadyExecuted` |

## 6.3 访问控制

| 检查项 | 位置 | 结论 |
|---|---|---|
| `onlyCore`（NFT mint/burn/setBaseURI） | `MinerNFT.sol:43-46` | **通过**。`core` 已绑定（链上 `nft.core = 0x1a5c...06c0`），`mint` 的 `handleUsed` 防重复（`60-61`） |
| `setCore` 一次性 + deployer 守卫 | `MinerNFT.sol:49-55` | **通过**。`msg.sender == deployer` 且 `core == address(0)`，第三方无法抢跑绑定（只有 deployer 能调）。注意：`core` 一旦设错**永远改不了**，这是被 C-01 放大的一把双刃剑 |
| `onlyMinter` | `AgentToken.sol:26-29` | **通过**。链上 `token.minter = 0x1a5c...`（CityCore），`setMinter` 一次性（`34`） |
| `onlyOwner`（treasury/registry/router/WBNB） | `CityCore.sol:224,230,716,755` | **通过**（机制层面）。全部具名 `require` / modifier 有效，OZ `Ownable` 的 `onlyOwner` 是硬 revert 而非静默 if（不是"silent modifier"反模式） |
| `onlyNFT` | `CityCore.sol:877` | **通过**。`msg.sender != address(nft)` 即 revert，任何外部地址无法伪造 `onMinerTransfer` |
| `onlySelf` 是否真的无法绕过 | `FrenzoMultiSig.sol:68-71` | **通过**。`msg.sender != address(this)` 硬 revert；`address(this)` 只可能通过 `execute` 的 `t.to.call{value}(t.data)`（`140`）产生，而那需要 `confirmations >= required`。EOA/合约直接调用 `addOwner/removeOwner/replaceOwner/changeRequired` 一律 `NotSelf`（`test-ms-rotation.js:77-82` 已实测） |
| `onlyOwner`（多签内部） | `FrenzoMultiSig.sol:62-65` | **通过**。`isOwner[msg.sender]` 硬 revert |
| 一人一台矿机约束 | `CityCore.sol:393` + `883-885` | **通过**。铸造与转让两条路径都校验；`from == to` 时先 `delete minerOf[from]` 再检查，不会误报 |

## 6.4 经济不变量（逐条实算）

| 不变量 | 结论 | 证据 |
|---|---|---|
| **I-1 `Σ(friends+1) == totalFriendUnits`** | **通过**（但见 H-01 的语义漏洞） | 建立：`+1/+1/+2`（`828-830`）；解除：`-1/-1/-2`（`774-776`），两处符号严格对称。链上 `12 + 8×2 = 28` ✔ |
| **I-1' `friends == 真实好友边数`** | **不成立** | H-01：重复 accept 后 `friends` 永久高于真实边数，且 `removeFriend` 追不回来 |
| **I-2 `Σ(shareRevenue) == totalKeyValue`** | **通过** | 铸造 `shareCost` 两侧同加（`417,420`）；买入 `cost` 两侧同加（`470-471`）；卖出两侧同减同一 `drop`（`508-510`）。链上 `12 × 6.25e13 = 7.5e14` 与 `totalKeyValue` 完全一致 ✔ 唯一隐患：`508` 的 `min` 截断会在极端情形下静默掩盖不一致，建议改 `assert` |
| **I-3 `balance ≥ totalKeyValue`** | **通过** | 费用从交易额中另取、不侵蚀储备（`465-466, 504-505`）；铸造保留 `shareCost`（`424`）。链上 `balance == totalKeyValue == 750000000000000` ✔ |
| **I-3' `balance ≥ totalKeyValue + ΣbestOffer + ΣrefundCredit`** | **不成立** | C-02：`buybackAndBurn` 只看前一项 |
| **I-4 `Σ权重 ≈ 10000 bps`** | **通过**（不是不变量） | `_powerOf`（`269-278`）只是展示用的两个整数除法之和，最多 2 bps 级偏差；所有池子在 `_accrue`（`538-545`）里严格用 `3000/10000` 与 `10000-3000`，**分账侧精确 30/70，不存在 bps 泄漏** |
| **I-5 `Σshares[id] == miners[id].supply`** | **通过** | 铸造 `=MINT_KEYS`（`416-418`）、买入 `+=amount`（`469,473`）、卖出 `-=amount`（`507,512`），无第三处写入。因此曲线兑付储备不会被超发 |
| **I-6 `ownerRatio` 与 `SPEC.md:270-277` 一致** | **通过** | supply≤3→10000（`285`）、4→9918、10→9423、50→6124、100→2000（`287`），与文档表格逐点吻合 |
| **I-7 `accPerShare` 不可被重复领取** | **通过** | `claim`（`604-609`）/ `_settleUser`（`444-447`）都以 `shareDebt` 为水位并即时前推；改份额前必先 `_settleUser`（`461,500`） |
| **I-8 铸造价覆盖赠送 key 成本** | **通过** | `costToBuy(0,2) = 1e18/16000 = 6.25e13 < 3e14`，`paid - shareCost` 不下溢（`424`）。⚠ `MINT_KEYS` 若改 3 → `3.125e14 > 3e14` 下溢、铸造全断（`57-59` 的注释已正确警示） |

## 6.5 多签专项

| 检查项 | 位置 | 结论 |
|---|---|---|
| `execute` 失败回滚 | `139-147` | **通过**（状态正确回滚，可重试）。仅事件不可达（Info-9） |
| 重放 | `139-140` + `36-37` | **通过**。`executed` 先置位、`txId` 单调递增，无法二次执行同一提案 |
| 阈值变更不可单方面修改 | `195-199` | **通过**。`changeRequired` 是 `onlySelf`，必须走 `submit→confirm→execute`（`ms.js:122-130` 提交后仍需第二票） |
| `addOwner` / `removeOwner` / `replaceOwner` 只能走多签 | `153,162,180` | **通过**。均 `onlySelf`，直连必 `NotSelf` |
| owner 数量下限保护 | `164` | **通过**。`ownerCount - 1 < required` 即 `TooFewOwners`，不会出现 `required > ownerCount` |
| 阈值合法性 | `76, 196` | **通过**。构造与变更都校验 `1 ≤ required ≤ ownerCount`（0 票阈值不可达） |
| 构造重复 owner | `80` | **通过**。`isOwner[o]` 查重，`address(0)` 被拒 |
| `revoke` 下溢 | `127-128` | **通过**。先校验 `confirmed[...] == true` 再 `-=1` |
| 资金与合约所有权解耦 | 机制 | **通过**。多签没有 owner 概念，提款只受 `required` 约束；CityCore renounce 与否都不影响多签余额。⚠ 但"2-of-2 后退化为单点"的风险见 Info-12 |

## 6.6 代币

| 检查项 | 位置 | 结论 |
|---|---|---|
| `mint` 上限 | `AgentToken.sol:40-43` | **通过**。`totalSupply() + amount > MAX_SUPPLY` 即 revert；且 CityCore 侧 `totalMined` 另有 `MAX_SUPPLY - totalMined` 的独立天花板（`534`），双重限制 |
| `mint` 权限 | `26-29, 32-37` | **通过**。`minter` 一次性设置，链上已锁定为 CityCore |
| `burn` 授权 | `46-48` | **通过**。只 burn `msg.sender` 自身余额，无法烧他人 |
| `burnFrom` 授权 | `51-54` | **通过**。`_spendAllowance(from, msg.sender, amount)` 先行扣减，无限授权/不足额均由 OZ 处理；只被 `acceptFriend`（`823-824`）与 `burnTokens`（`1027`）调用 |
| 手续费销毁对上限的影响 | 机制 | **通过**（无害）。销毁会让 `totalSupply` 下降从而"腾出"铸造空间，但 CityCore 的 `totalMined` 已独立封顶，累计新增铸造不会超过 `MAX_SUPPLY` |

## 6.7 部署与运维

| 检查项 | 位置 | 结论 |
|---|---|---|
| 铸造→注册表校验链路 | `CityCore.sol:394` + `MinerNFT.sol:58-66` | **通过**（逻辑正确：先验 handle 归属再 mint，`handleUsed` 防重复） |
| `mintMiner` 里 hook 的时序 | `390-433` vs `876-889` | **通过**。`nft.mint`（`398`）早于 `miners[id]` 初始化（`400`），hook 因 `!m.exists` 直接 return（`879`），不会误删 `minerOf` 或在铸币时触发 `_clearMarket` |
| 多余付退款 | `425-428, 478-481, 939-942` | **通过**。三处都按 `msg.value - 应付` 退回，且 `call` 失败即 revert |
| 市场失效后出价处理 | `887-888` | **通过**。任何 ERC721 转账（含直接 `transferFrom`，绕过市场）都会触发 `_clearMarket`，挂单与出价一并作废，不存在"换了主人还按老挂单成交" |
| 挂单前置授权检查 | `900-901, 996-997` | **通过**。`getApproved == address(this) || isApprovedForAll` 双路径检查 |
| 编译一致性 | `compile.js` | **通过**（源码可编译、无 error）。但 artifact 不含 `deployedBytecode`（Info-6） |

---

# 七、真实问题 vs 设计取舍

**真实问题（代码与意图/文档不一致，或存在可被第三方利用的缺陷）**

| ID | 性质 |
|---|---|
| C-01 | 真实 · 运维/密钥管理缺陷，可直接接管费用流与前端 |
| C-02 | 真实 · 记账漏项 + 无许可滑点，可偷走出价托管 |
| H-01 | 真实 · 缺幂等校验，可永久刷好友权重 |
| H-02 | 真实 · 计数器与 owner 集合不同步，阈值可被单票绕过 |
| H-03 | 真实 · push 支付导致第三方可阻断他人市场 |
| M-01 ~ M-09 | 真实 · 配置漂移 / 产出蒸发 / 群组可用性 / 身份可伪造 / 资金锁死 / 元数据不可修复 / 种子私钥丢失 / 冒烟无效 |
| L-01, L-02, L-03, L-05 | 真实 · 边界与授权快照缺陷 |
| L-06 | 真实 · 信息披露失实（涉及手续费、权重公式、总供应量——都是募资叙事核心） |

**设计取舍（可接受，但需在文档中明示）**

| 项 | 取舍内容 |
|---|---|
| 转让时 `ownerPending` 归买家 | `CityCore.sol:895` 已声明；只需修正 `listMiner` 的误导性注释（Info-1） |
| 10% 双向手续费（往返成本约 20%） | 参数选择问题。friend.tech 原版是 5%+5%，本项目为 10%+10%（由 `FEE_BPS=1000` 决定）。往返 20% + 曲线价差意味着 key 流动性极低，需在 UI 明示"卖出成本" |
| key 持有者在 supply ≤ 3 时零收益 | `ownerRatio` 在 supply≤3 返回 10000（`285`），第 2~3 份 key 的买家在有人继续买入前拿不到任何 key 池分成。属曲线设计，但应在购买页提示 |
| 好友费不退、加回要再付费 | 已表述，防"加了再删刷免费额度"（`762`）。副作用是可被单方面撕好友后反复收费 |
| 所有权保留未 renounce | 已知。但必须先把 owner 迁到多签（M-01 / C-01），否则"保留"实为"单钥可改一切" |
| 无链上女巫防护 | `SPEC.md:78` 已声明，靠铸造价与好友费提高成本 |
| 2-of-3 在多签层面仍是"3 把钥匙 2 把即可动钱" | 结构性取舍；但"减到 2-of-2"应视为风险动作（Info-12） |

---

# 八、总结表

| ID | 级别 | 标题 | 位置 | 类型 | 必修 |
|---|---|---|---|---|---|
| C-01 | Critical | owner 私钥 + VPS root 口令明文落盘，可接管费用流与前端 | `.testkey`; `deploy.js:36-40`; `deploy-final.js:25,33`; 无 `.gitignore` | 真实 | ✅ |
| C-02 | Critical | `spareBnb` 漏算托管负债 + 调用方控滑点 → 抽干出价托管 | `CityCore.sol:722-750, 857-865, 959-975` | 真实 | ✅ |
| H-01 | High | `acceptFriend` 可重复确认 → 好友单位永久通胀 | `CityCore.sol:792-804, 809-833` | 真实 | ✅ |
| H-02 | High | 多签 `confirmations` 不随轮换清理 → 单票可执行 | `FrenzoMultiSig.sol:116-118, 162-192, 133-148` | 真实 | ✅ |
| H-03 | High | `_splitFee` push 支付 → 拒收合约可卡死他人 key 市场 | `CityCore.sol:840-854, 477, 516` | 真实 | ✅ |
| M-01 | Medium | `deploy.js` treasury 指向单人 EOA | `deploy.js:20,101-106` | 真实 | ✅ |
| M-02 | Medium | 多签地址三套不一致，校验脚本会写错配置 | `confirm-multisig.js:7,31-34`; `deploy-final.js:27` | 真实 | ✅ |
| M-03 | Medium | 空池时产出计入 `totalMined` 但不分配，永久蒸发 | `CityCore.sol:530-548` | 真实 | ✅ |
| M-04 | Medium | 群组绑定创建者当前矿机，卖出后群组死掉 | `CityCore.sol:658-671, 881` | 真实 | ✅ |
| M-05 | Medium | MockRegistry 无权限 → 测试网身份可伪造 | `MockRegistry.sol:8-10`; `CityCore.sol:394` | 真实 | ✅ |
| M-06 | Medium | 出价人拒收 BNB → 该矿机市场永久失效、资金锁死 | `CityCore.sol:959-975, 978-985` | 真实 | ✅ |
| M-07 | Medium | 元数据依赖单点域名且 `setBaseURI` 无入口（不可修复） | `MinerNFT.sol:283-290, 292-309` | 真实 | ✅ |
| M-08 | Medium | 种子矿机私钥不落盘，12 台永久不可操作 | `deploy-final.js:84-93` | 真实 | ✅ |
| M-09 | Medium | registry 冒烟只验"可调用"，不验语义 | `deploy.js:115-136` | 真实 | ✅ |
| L-01 | Low | `uint96` 静默截断（挂单价/出价） | `CityCore.sol:904, 967` | 真实 | ⬜ |
| L-02 | Low | 多签提案无过期 | `FrenzoMultiSig.sol:96-103` | 真实 | ⬜ |
| L-03 | Low | `acceptFriend` 用旧 `toOwner` 快照授权 | `CityCore.sol:801, 812` | 真实 | ⬜ |
| L-04 | Low | 部署脚本无幂等/无备份 | `deploy.js:163-164`; `deploy-final.js:44-50` | 真实 | ⬜ |
| L-05 | Low | 构造函数不校验 `treasury_` | `CityCore.sol:213-222` | 真实 | ⬜ |
| L-06 | Low | 手续费/权重/总供应量等核心参数文档漂移 | `CityCore.sol:22,40-57,291,410`; `CONTRACTS.md:89-90`; `SPEC.md:87` | 真实 | ✅ |
| L-07 | Low | `burnTokens` 死代码 | `CityCore.sol:1026-1028` | 真实 | ⬜ |
| L-08 | Low | 运行时占 EIP-170 73%（18,013/24,576） | `CityCore` | 取舍 | ⬜ |
| I-1~I-12 | Info | 注释矛盾 / 死代码 / 事件不可达 / 测试断言写反等 | 见第五节 | 混合 | ⬜ |

---

# 九、上线前必修清单（按执行顺序）

**P0 — 立刻（今天）**

1. **撤换密钥**：把 `CityCore.owner` / `AgentToken.owner` 迁到多签（或直接 `renounceOwnership`）；把 `.testkey`、`testnet-wallets.json` 从所有副本删除；补 `.gitignore`；生成全新 owner 密钥于离线机。旧私钥一律视为已泄露（`0xd11f...9A13` 曾持有 0.776 BNB）。
2. **改 VPS root 口令**（`deploy-final.js:25` 已泄露），禁密码登录、只留密钥，并审计 `/var/www/frenzo/*` 是否被改过。
3. **确认 `0x8fa19dc4...df6a`（deploy.js 内置 TREASURY）无人认领**：链上有 0.0288 BNB，若是历史 EOA，把其余额与权限彻底下线。

**P1 — 上主网前必须改代码**

4. 修 H-01（`requestFriend` + `acceptFriend` 双重幂等闸）。上线前对现有 28 个好友单位做一次链上快照核对（当前 `28 == 12 + 8×2`，干净）。
5. 修 C-02（`spareBnb` 扣减 `escrowedOffers` + `totalRefundCredit`；`buybackAndBurn` 强制滑点下限）。**在修完之前不要 `setRouter` / `setWBNB`** —— 现在二者为 `0x0`，功能是关闭的，这是当前唯一的保护。
6. 修 H-02（多签改 `_liveConfirmations` 或轮换时清票）+ L-02（提案 TTL）。**在修完之前不要执行任何 `replaceOwner` / `removeOwner`**，否则阈值会被静默降低。
7. 修 H-03（`creatorCredit` pull 模式）与 M-06（出价退款失败转记账），否则第三方合约可卡死市场。
8. 修 M-01 / M-02（treasury 必须显式传参并断言；多签地址只从链上读，禁止硬编码、禁止写回）。
9. 修 M-03（`totalMined += used`）、M-04（群组绑定 `creatorMinerId` + 接管策略）、M-07（接回 `_portrait` 或给 core 加改 URI 入口）。

**P2 — 上线前必须做完的运维/流程**

10. M-05 / M-09：主网切换真实 registry 前，用**真实 handle + 已知 owner** 做端到端断言，不要只测"能调用"。
11. M-08：种子矿机改为"确定性派生 + 加密落盘 + 600 权限 + 仓库外保存"，并在 `deployment-*.json` 记录地址。
12. L-04：部署脚本加幂等（存在即 `--force`）与时间戳归档，禁止静默覆盖 `deployment-97.json`。
13. L-06：把 `FEE_BPS`（10%）、`CREATOR_FEE_BPS`（50% of fee）、`_powerOf`（线性 30/70）、`MAX_SUPPLY`（1e8）、`FRNZ` 这五项在 `CONTRACTS.md` / `SPEC.md` / 代码注释里统一。这是募资叙事，必须与代码一致。
14. 删除死代码（`_log2Fixed`、`OWNER_BASE_BPS/OWNER_FRIEND_BPS/OWNER_MAX_BPS`、`LOG2_101`、`VALUE_UNIT`、`_portrait` + 5 个调色板 storage 数组、`burnTokens`），为 EIP-170 留余量。
15. 补 `deployedBytecode` 到 artifact、钉扎 solc 精确版本、在主网 BscScan 完成源码验证（当前 artifact 只有 creation bytecode，无法与链上运行时做确定性比对）。
16. `test-ms-rotation.js:65` 的断言方向改反（应断言"减到等于阈值是可接受但需显式确认的风险动作"，而不是把它当成功用例）。

**P3 — 建议（不阻塞上线）**

17. `scripts/poc-audit-v3.js` 保留为回归测试：修完 C-02/H-01 后它应当**全红**（当前 8/8 通过 = 漏洞仍在）。把这两个用例搬进 `forge test`，并补 I-2/I-3/I-3'/I-5 四条 `invariant_` 断言，尤其 I-3'（本次 C-02 的直接检测器）。
18. L-01（`uint96` 显式校验）、L-03（实时校验 `miners[r.to].owner`）、L-05（构造函数零地址校验）、L-07、Info-9（`ExecutionFailure` 改为不 revert）、Info-10（禁止 `address(this)` 成为 owner）、Info-12（文档写明 2-of-2 风险）。
