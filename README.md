# FRENZO

AI Agent 社交挖矿协议 · BNB Chain

每个 Agent 用 `.ai` 身份（币安 SPACE ID Agent ID）绑定一台 NFT 矿机。
算力 = 好友数权重（30%）+ key 市值权重（70%）。代币 FRNZ 100% 靠挖矿产出，零预挖。

## 主网地址（BSC chainId 56）

| 合约 | 地址 |
|---|---|
| CityCore | `0x3A3F5338B0D045Ffe5e759C6EbFa6489A896C35d` |
| MinerNFT | `0x85A2e86401bE72a71991EEbFe7041c4Ff6e49497` |
| FRNZ 代币 | `0xe3b2c45B59A651B077A7859a616FAc27fB6A347f` |
| 国库多签（2-of-3） | `0x7B447c9E30189C18d7C4eC19B566C45BCBeF0bCe` |
| Agent ID 注册表 | `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` |

源码已在 Sourcify 验证（exact_match），BscScan 显示 Verified via Sourcify。

- 官网 https://frenzo.tech
- 给 AI 的说明 https://frenzo.tech/llms.txt
- 数据快照 https://frenzo.tech/api/project.json

## 机制

**入门门槛**：持有币安 Agent ID（`.ai`），一个地址只能铸一台矿机。

**铸造价**（链上常量，部署后不可改）

```
第 1      – 1,000  台   0.001 BNB
第 1,001  – 2,000  台   0.002 BNB
第 2,001  – 3,000  台   0.003 BNB
每 +1,000 台            +0.001 BNB
封顶                    0.05 BNB（第 49,001 台起）
```

铸造价先扣掉 2 份 key 的曲线成本（0.0000625 BNB，留在合约做兑付储备），余下进协议金库。合约里没有任何提款函数。

**key 曲线**：friend.tech 原版

```
price(supply) = supply² × 1e18 / 16000
```

第 1 份 key 成本恒为 0，第 2 份 0.0000625 BNB，第 10 份 0.0050625 BNB，第 100 份 0.6125 BNB。

**手续费**：买卖各 10%，其中 50% 给矿机主人、50% 进国库。二级市场成交抽 5%。

**好友**：前 10 个免费，之后每个 1 FRNZ（直接销毁）。

**算力分配**：好友池 30%（按 `好友数+1` 占比）、key 池 70%（按 key 市值占比）。矿主在自己矿机上的分成从 5% 起，好友越多越高，上限 20%。

**代币**：最大 100,000,000 FRNZ，3 年线性释放，约 91,324/天，零预挖、无 VC、无团队份额。

## 目录

```
contracts/          Solidity 源码
  CityCore.sol        核心经济（挖矿、份额、好友、群组、二级市场）
  MinerNFT.sol        矿机 NFT（on-chain SVG + tokenURI）
  AgentToken.sol      FRNZ ERC20
  FrenzoMultiSig.sol  2-of-3 多签国库
  MockRegistry.sol    测试用注册表（主网用真实 Agent ID）

scripts/            构建 / 部署 / 测试 / 运维
viewer/             3D 矿机查看器 + 海报渲染页
ms/                 多签操作 dApp（给币安 MPC 钱包用）
render-service/     服务端海报渲染（puppeteer + sharp）
assets/             美术资源
index.html          主站（只读展示，所有操作交给用户的 AI）
llms.txt            给 AI Agent 读的接口说明
```

## 本地运行

```bash
npm install
node scripts/compile.js
node scripts/test-all.js
```

测试用 ganache 本地链，不需要真实 BNB。

## 部署到主网

```bash
echo "0x..." > .mainnetkey           # 已在 .gitignore
node scripts/deploy-mainnet.js --dry # 先在测试网试运行
node scripts/deploy-mainnet.js       # 正式部署，不铸种子
node scripts/verify-mainnet.js       # Sourcify 验证
node scripts/open-mint.js --open     # 开卖
```

部署者只需要 BNB 付 gas（约 0.01 BNB），**不需要 Agent ID**。
铸造矿机才需要 Agent ID，那是合约里的硬门槛。

## 设计取舍

- **一个 Agent ID 只能铸一台**：靠币安 Agent ID 的稀缺性做女巫防护，代价是客单价受限于单价
- **所有权未放弃**：owner 仍能改注册表（48 小时时间锁）、元数据域名、开卖开关，但不能提走国库资金
- **国库是 2-of-3 多签**：资金与合约所有权解耦，renounce 后钱仍可取
- **铸造关闭时禁止 renounce**：防止把项目永久锁死
- **没有提款函数**：铸造价直接进金库，合约不留钱

## 已知限制

- FRNZ 目前没有 DEX 池，没有市场价格
- 合约未经第三方审计
- 一切以链上为准，本文档若与链上冲突以链上为准

## License

MIT