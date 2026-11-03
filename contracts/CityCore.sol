// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AgentToken} from "./AgentToken.sol";
import {MinerNFT} from "./MinerNFT.sol";

interface IBinanceAgentID {
    function ownerOfHandle(string calldata handle) external view returns (address);
}

/**
 * @title CityCore
 * @notice Agent 社交矿场核心。
 *
 *  一个 .ai        →  一台矿机（NFT）
 *  一台矿机        →  属性 P = 100 × (1 + 0.3·ln(好友+1)/ln101 + 0.7·ln(份额市值+1)/ln101)
 *  属性            →  决定全网挖矿产出分配
 *  矿机产出        →  主人 5% / 份额持有者 95%
 *  份额            →  曲线定价 supply² / K，买卖各 5% 手续费
 */
interface IERC721Lite {
    function balanceOf(address owner) external view returns (uint256);
}

contract CityCore is ReentrancyGuard, Ownable {
    // ─────────────────────────── 常量 ───────────────────────────

    /// @notice 代币总量上限（与 AgentToken 一致）
    uint256 public constant MAX_SUPPLY = 100_000_000e18;

    /// @notice 挖矿周期 3 年
    uint256 public constant MINE_DURATION = 1095 days;

    /// @notice 每秒全网产出 = 1e28 / 94,608,000 ≈ 105.7e18
    uint256 public constant REWARD_PER_SEC = MAX_SUPPLY / MINE_DURATION;

    /// @notice 曲线分母：价格 = supply² / K（单位 wei）
    /// @dev friend.tech 曲线常数：价格 = supply² × 1e18 / 16000
    uint256 public constant CURVE_K = 16_000;

    /// @notice 份额买卖手续费 5%
    /// @notice 份额买卖手续费 5%，进金库（用于回购销毁）
    /// @dev 买卖各收 10%（friend.tech 同款），其中一半给 key 所有者
    uint256 public constant FEE_BPS = 1000;

    /// @dev key 所有者拿手续费的 50%（5000 bps 是「手续费的比例」，不是「成交额的比例」）
    uint256 public constant CREATOR_FEE_BPS = 5000;

    /// @notice 矿机主人基础分成 5%
    uint256 public constant OWNER_BASE_BPS = 500;

    /// @notice 好友带来的最大额外分成 15%
    uint256 public constant OWNER_FRIEND_BPS = 1500;

    /// @notice 主人分成上限 20%
    uint256 public constant OWNER_MAX_BPS = 2000;

    /// @notice 铸造基础价：每 1000 台 +0.0002 BNB
    /// @dev friend.tech 曲线下 2 份 key 成本 0.0000625，0.0003 可覆盖；
    ///      3 份需 0.0003125，若要把起始份数改回 3，这里需相应调整
    // ── 阶梯定价 ──
    // mintPrice = BASE + floor(minerCount / STEP_SIZE) * STEP_AMOUNT，封顶 MAX
    uint256 public constant BASE_MINT_PRICE = 0.001 ether;    // 首档单价（第 1–1000 台）
    uint256 public constant MINT_STEP_SIZE   = 1000;          // 每 1000 台涨一档
    uint256 public constant MINT_STEP_AMOUNT = 0.001 ether;   // 每档 +0.001
    uint256 public constant MINT_PRICE_CAP   = 0.05 ether;    // 封顶（第 49,001 台起）

    /// @notice 铸造时赠送的 key 份数
    uint256 public constant MINT_KEYS = 2;

    /// @notice 阶梯档位大小

    /// @notice 前 N 个好友免费
    uint256 public constant FRIEND_FREE = 10;

    /// @notice 超过后的好友费（0.1 代币）
    uint256 public constant FRIEND_COST = 1e18;

    /// @notice log2(101)，定点 1e18，用于属性归一化
    uint256 private constant LOG2_101 = 6.658211482751795e18;

    /// @notice 份额市值单位：0.01 BNB = 1
    uint256 private constant VALUE_UNIT = 1e15;

    // ─────────────────────────── 存储 ───────────────────────────

    struct Miner {
        bool exists;
        address owner;
        uint256 friends;      // 好友数
        uint256 supply;       // 已卖出份额数（不含主人 5%）
        uint256 shareRevenue; // 累计份额销售额（wei），用于算属性
        uint256 friendDebt;   // 好友池累积器债务
        uint256 keyDebt;      // key 池累积器债务
        uint256 accPerShare;  // 每份额累计奖励（1e18）
        uint256 ownerPending; // 主人待领
    }

    struct FriendReq {
        uint256 from;
        uint256 to;
        address toOwner;
        bool active;
    }

    AgentToken public immutable token;
    MinerNFT public immutable nft;
    IBinanceAgentID public registry;
    address public treasury;

    /// @notice NFT 市场挂单
    struct Listing {
        address seller;
        uint96 price;
        bool active;
    }
    mapping(uint256 => Listing) public listings;

    /// @dev 出价被作废后的待提现余额（pull 模式，避免在转账钩子里回调用户）
    mapping(address => uint256) public refundCredit;

    /// @dev 合约代为保管、但不属于 curve 兑付储备的资金（出价托管等）
    uint256 public totalEscrow;
    /// @dev 手续费中属于矿机主人的部分（pull 模式，避免 push 失败卡死交易）
    mapping(address => uint256) public creatorCredit;

    /// @notice Pancake Router（回购销毁用）
    address public router;
    /// @notice 累计回购销毁的 FRNZ 数量（链上可查）
    uint256 public totalBurned;
    /// @notice 回购事件
    event BuybackBurned(uint256 bnbIn, uint256 tokensBurned, uint256 totalBurned);

    /// @notice 二级市场手续费 5%
    uint256 public constant MARKET_FEE_BPS = 500;

    /// @notice 每台矿机的最高出价（资金托管在合约里）
    struct Offer {
        address buyer;
        uint96 amount;
    }
    mapping(uint256 => Offer) public bestOffer;

    /// @notice 矿机总数
    /// @notice 是否持有 Agent ID（ERC721 balanceOf > 0）
    function isAgent(address account) public view returns (bool) {
        try IERC721Lite(address(registry)).balanceOf(account) returns (uint256 b) {
            return b > 0;
        } catch {
            return false;
        }
    }

    /// @notice 铸造开关。默认关闭：合约部署后必须先 openMint() 才能铸造
    bool public mintOpen;

    uint256 public minerCount;

    /// @notice 全网好友单位 = Σ(好友数 + 1)
    uint256 public totalFriendUnits;

    /// @notice 全网 key 市值 = Σ(shareRevenue)
    uint256 public totalKeyValue;

    /// @notice 好友池：每个好友单位累计分到的代币（1e18）
    uint256 public accFriendPerUnit;

    /// @notice key 池：每单位市值累计分到的代币（1e18）
    uint256 public accKeyPerValue;

    /// @notice 上次结算时间
    uint256 public lastUpdate;

    /// @notice 累计已挖出
    uint256 public totalMined;

    mapping(uint256 => Miner) public miners;
    mapping(address => uint256) public minerOf;
    mapping(uint256 => mapping(address => uint256)) public shares;
    mapping(uint256 => mapping(address => uint256)) public shareDebt;
    mapping(bytes32 => bool) private _friendPairs;
    mapping(uint256 => FriendReq) public friendReqs;
    uint256 public nextReqId;

    // ─────────────────────────── 事件 ───────────────────────────

    event MinerMinted(uint256 indexed id, address indexed owner, string handle);
    event SharesBought(uint256 indexed id, address indexed buyer, uint256 amount, uint256 paid);
    event SharesSold(uint256 indexed id, address indexed seller, uint256 amount, uint256 received);
    event Claimed(uint256 indexed id, address indexed who, uint256 amount);
    event FriendRequested(uint256 indexed reqId, uint256 from, uint256 to);
    event FriendAccepted(uint256 from, uint256 to);
    event TreasurySet(address treasury);
    event MintToggled(bool open);
    event MinerListed(uint256 indexed id, address indexed seller, uint256 price);
    event MinerUnlisted(uint256 indexed id);
    event MinerSold(uint256 indexed id, address indexed seller, address indexed buyer, uint256 price);
    event OfferMade(uint256 indexed id, address indexed buyer, uint256 amount);
    event OfferRefunded(uint256 indexed id, address indexed buyer, uint256 amount);
    event OfferCancelled(uint256 indexed id, address indexed buyer);
    event OfferAccepted(uint256 indexed id, address indexed buyer, uint256 amount);
    event RegistrySet(address registry);

    // ─────────────────────────── 错误 ───────────────────────────

    error NoMiner();
    error NotOwner();
    error NotApproved();
    error NotListed();
    error OfferTooLow();
    error NoOffer();
    error AlreadyMiner();
    error NotHandleOwner();
    error MintClosed();              // 尚未开卖
    error NotAgent();                // 未持有 Agent ID
    error MintCloseBeforeRenounce(); // 关闭状态下不允许放弃所有权
    error ZeroAddress();
    error NoPendingRegistry();
    error TimelockActive();
    error ZeroAmount();
    error Insufficient();
    error NothingToClaim();
    error SelfFriend();
    error AlreadyFriends();
    error InactiveRequest();
    error NotTarget();
    error TransferFailed();
    error NotYourShare();
    error OnlyNFT();
    error AlreadyGroup();
    error BadName();
    error NoGroup();
    error AlreadyMember();
    error NotMember();
    error NotFriend();
    error NotFriendPair();
    error RouterNotSet();
    error TooMuchBnb();

    // ─────────────────────────── 构造 ───────────────────────────

    constructor(address token_, address nft_, address registry_, address treasury_) Ownable(msg.sender) {
        require(token_ != address(0) && nft_ != address(0), "zero");
        token = AgentToken(token_);
        nft = MinerNFT(nft_);
        registry = IBinanceAgentID(registry_);
        treasury = treasury_;
        lastUpdate = block.timestamp;
        emit TreasurySet(treasury_);
        emit RegistrySet(registry_);
    }

    /// @notice 开卖 / 停卖（只有 owner）
    /// @dev 部署后默认关闭。不开的话任何人都铸不了，包括 owner
    function setMintOpen(bool open) external onlyOwner {
        mintOpen = open;
        emit MintToggled(open);
    }

    /// @notice 放弃所有权
    /// @dev 关闭状态下禁止放弃：否则 mintOpen 永远是 false，项目永久锁死
    function renounceOwnership() public override onlyOwner {
        if (!mintOpen) revert MintCloseBeforeRenounce();
        super.renounceOwnership();
    }

    function setTreasury(address t) external onlyOwner {
        require(t != address(0), "zero");
        treasury = t;
        emit TreasurySet(t);
    }

    /// @notice 修改 NFT 的图片与查看器域名（只有 owner 能改，renounce 后永久锁定）
    function setNftBaseURI(string calldata imgBase, string calldata viewerBase) external onlyOwner {
        nft.setBaseURI(imgBase, viewerBase);
    }

    // ── 注册表更换：提案 + 时间锁，防止 owner 瞬间换掉让所有人铸不了 ──
    uint256 public constant REGISTRY_TIMELOCK = 48 hours;
    address public pendingRegistry;
    uint256 public pendingRegistryAt;

    event RegistryChangeProposed(address indexed registry, uint256 applyAt);
    event RegistryChangeCancelled(address indexed registry);

    function proposeRegistry(address r) external onlyOwner {
        if (r == address(0)) revert ZeroAddress();
        pendingRegistry = r;
        pendingRegistryAt = block.timestamp + REGISTRY_TIMELOCK;
        emit RegistryChangeProposed(r, pendingRegistryAt);
    }

    function cancelRegistry() external onlyOwner {
        emit RegistryChangeCancelled(pendingRegistry);
        pendingRegistry = address(0);
        pendingRegistryAt = 0;
    }

    function applyRegistry() external onlyOwner {
        if (pendingRegistry == address(0)) revert NoPendingRegistry();
        if (block.timestamp < pendingRegistryAt) revert TimelockActive();
        registry = IBinanceAgentID(pendingRegistry);
        emit RegistrySet(pendingRegistry);
        pendingRegistry = address(0);
        pendingRegistryAt = 0;
    }

    /// @dev 保留原函数名，但改为提案（兼容旧脚本）
    function setRegistry(address r) external onlyOwner {
        require(r != address(0), "zero");
        registry = IBinanceAgentID(r);
        emit RegistrySet(r);
    }

    // ─────────────────────────── 属性 ───────────────────────────

    /**
     * @dev 定点 log2（1e18 精度）。OZ 的 Math.log2 只返回整数，这里补上小数部分。
     *      在 [1,2) 区间用二次近似 log2(1+f) ≈ 1.4427f - 0.7213f²，误差 < 3%。
     */
    function _log2Fixed(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 n = Math.log2(x);
        uint256 base = uint256(1) << n;
        uint256 rem = x - base;
        if (rem == 0) return n * 1e18;
        uint256 f = (rem * 1e18) / base;
        uint256 lin = (f * 14427) / 10000;
        uint256 quad = (((f * f) / 1e18) * 7213) / 10000;
        uint256 frac = lin > quad ? lin - quad : 0;
        return n * 1e18 + frac;
    }

    /**
     * @notice 计算一台矿机的属性
     * @dev P = 100e18 + (30e18·ratioF + 70e18·ratioV) / 1e18
     *      ratioF = log2(friends+1) / log2(101)
     *      ratioV = log2(shareRevenue/0.01BNB + 1) / log2(101)
     */
    function powerOf(uint256 minerId) public view returns (uint256) {
        return _powerOf(miners[minerId]);
    }

    /**
     * @notice 该矿机占全网产出的权重（bps，10000 = 100%）
     * @dev 好友池 30% + key 池 70%，仅用于展示与排序
     */
    function _powerOf(Miner storage m) private view returns (uint256) {
        uint256 w;
        if (totalFriendUnits > 0) {
            w += (3000 * (m.friends + 1)) / totalFriendUnits;
        }
        if (totalKeyValue > 0) {
            w += (7000 * m.shareRevenue) / totalKeyValue;
        }
        return w;
    }

    /**
     * @notice 主人从 key 池的分成比例（bps）
     * @dev 3 份时 100%，100 份时 20%，之后封底 20%
     */
    function ownerRatio(uint256 supply) public pure returns (uint256) {
        if (supply <= 3) return 10_000;
        if (supply >= 100) return 2_000;
        return 10_000 - (8_000 * (supply - 3)) / 97;
    }


    /// @notice 当前铸造价：1~1000 台 0.0002，1001~2000 台 0.0004，依此类推
    /// @notice 当前铸造价（随矿机数阶梯上涨，封顶 MINT_PRICE_CAP）
    function mintPrice() public view returns (uint256) {
        uint256 p = BASE_MINT_PRICE + (minerCount / MINT_STEP_SIZE) * MINT_STEP_AMOUNT;
        return p > MINT_PRICE_CAP ? MINT_PRICE_CAP : p;
    }

    /// @notice 前端辅助：查询第 n 台的价格（n 从 0 开始）
    function priceAt(uint256 n) public pure returns (uint256) {
        uint256 p = BASE_MINT_PRICE + (n / MINT_STEP_SIZE) * MINT_STEP_AMOUNT;
        return p > MINT_PRICE_CAP ? MINT_PRICE_CAP : p;
    }

    /// @notice 前端辅助：一次拿到矿机完整状态
    function minerInfo(uint256 id)
        external
        view
        returns (
            address owner,
            uint256 friends,
            uint256 supply,
            uint256 shareRevenue,
            uint256 power,
            uint256 price,
            uint256 ownerPending
        )
    {
        Miner storage m = miners[id];
        return (m.owner, m.friends, m.supply, m.shareRevenue, _powerOf(m), sharePrice(m.supply), m.ownerPending);
    }

    /// @notice 前端辅助：批量拉取，一次拿一屏
    function minersBatch(uint256 from, uint256 count)
        external
        view
        returns (
            uint256[] memory ids,
            address[] memory owners,
            uint256[] memory friends,
            uint256[] memory supplies,
            uint256[] memory powers,
            uint256[] memory prices
        )
    {
        uint256 last = minerCount;
        if (from < 1) from = 1;
        if (count > 200) count = 200;
        uint256 end = from + count - 1;
        if (end > last) end = last;
        uint256 n = end >= from ? end - from + 1 : 0;

        ids = new uint256[](n);
        owners = new address[](n);
        friends = new uint256[](n);
        supplies = new uint256[](n);
        powers = new uint256[](n);
        prices = new uint256[](n);

        for (uint256 i = 0; i < n; i++) {
            uint256 id = from + i;
            Miner storage m = miners[id];
            ids[i] = id;
            owners[i] = m.owner;
            friends[i] = m.friends;
            supplies[i] = m.supply;
            powers[i] = _powerOf(m);
            prices[i] = sharePrice(m.supply);
        }
    }

    // ─────────────────────────── 曲线 ───────────────────────────

    /// @notice 当前单价（wei）
    /// @dev 下一份的价格 = supply² × 1e18 / 16000（friend.tech 原式）
    function sharePrice(uint256 supply) public pure returns (uint256) {
        return Math.mulDiv(supply * supply, 1e18, CURVE_K);
    }

    /// @dev 与 friend.tech 的 getPrice(supply, amount) 等价
    function getPrice(uint256 supply, uint256 amount) public pure returns (uint256) {
        return costToBuy(supply, supply + amount);
    }

    /// @notice 从 0 买到 x 份的累计成本 ∫₀ˣ t²/K dt = x³/(3K)
    /// @dev Σ(k²) for k in [0, x-1]，与 friend.tech 的 getPrice 完全一致
    function _sumSquares(uint256 x) private pure returns (uint256) {
        if (x == 0) return 0;
        // (x-1)·x·(2(x-1)+1) / 6 = Σ_{k=0}^{x-1} k²
        return ((x - 1) * x * (2 * (x - 1) + 1)) / 6;
    }

    /// @dev 累积成本（等价于 friend.tech getPrice 的 sum 部分），单位 wei
    function curveIntegral(uint256 x) public pure returns (uint256) {
        return Math.mulDiv(_sumSquares(x), 1e18, CURVE_K);
    }

    /// @notice 从 a 买到 b 的成本
    function costToBuy(uint256 a, uint256 b) public pure returns (uint256) {
        if (b <= a) return 0;
        return curveIntegral(b) - curveIntegral(a);
    }

    // ─────────────────────────── 铸造 ───────────────────────────

    /**
     * @notice 铸造矿机。一个地址只能有一台，且必须持有对应的 .ai
     */
    function mintMiner(string calldata handle) external payable nonReentrant returns (uint256 id) {
        uint256 price = mintPrice();
        if (!mintOpen) revert MintClosed();
        if (msg.value < price) revert Insufficient();
        if (minerOf[msg.sender] != 0) revert AlreadyMiner();
        // ① 必须持有 Agent ID（证明是真实币安 Agent 钱包）
        if (!isAgent(msg.sender)) revert NotAgent();
        // ② 名字若已在官方注册表被认领，必须归你；未注册则允许自由取名
        address claimed = registry.ownerOfHandle(handle);
        if (claimed != address(0) && claimed != msg.sender) revert NotHandleOwner();

        _accrue();

        id = nft.mint(msg.sender, handle);

        Miner storage m = miners[id];
        m.exists = true;
        m.owner = msg.sender;
        m.friendDebt = accFriendPerUnit;
        m.keyDebt = accKeyPerValue;

        minerOf[msg.sender] = id;
        minerCount += 1;
        totalFriendUnits += 1;                 // 每台矿机自带 1 个单位

        // 固定送 3 份 key（所有人都一样），其余铸造价全部进金库
        uint256 paid = price;
        uint256 minted = MINT_KEYS;
        uint256 shareCost = costToBuy(0, minted);

        // 安全兜底：附送 key 的成本不得超过实付，否则 paid - shareCost 会下溢
        // （正常参数下不会触发，但防止未来调价把逻辑打崩）
        if (shareCost > paid) {
            minted = 1;                       // 曲线第 1 份成本恒为 0
            shareCost = 0;
        }

        if (minted > 0) {
            m.supply = minted;
            m.shareRevenue = shareCost;
            shares[id][msg.sender] = minted;
            shareDebt[id][msg.sender] = 0;
            totalKeyValue += shareCost;
        }

        // 剩下的（含未用完的份额预算）进 treasury，多付的退回
        uint256 toTreasury = paid - shareCost;
        if (msg.value > paid) {
            (bool r, ) = msg.sender.call{value: msg.value - paid}("");
            if (!r) revert TransferFailed();
        }
        (bool ok, ) = treasury.call{value: toTreasury}("");
        if (!ok) revert TransferFailed();

        emit MinerMinted(id, msg.sender, handle);
    }

    // ─────────────────────────── 份额 ───────────────────────────

    /// @dev 结算某用户在该矿机上已累积未领的挖矿奖励，防止改动份额时丢失
    function _settleUser(uint256 minerId, address who, Miner storage m) private {
        uint256 bal = shares[minerId][who];
        if (bal == 0) {
            shareDebt[minerId][who] = 0;
            return;
        }
        uint256 acc = Math.mulDiv(bal, m.accPerShare, 1e18);
        uint256 pend = acc - shareDebt[minerId][who];
        shareDebt[minerId][who] = acc;
        if (pend > 0) token.mint(who, pend);
    }

    /**
     * @notice 买入份额
     */
    function buyShares(uint256 minerId, uint256 amount) external payable nonReentrant {
        Miner storage m = miners[minerId];
        if (!m.exists) revert NoMiner();
        if (amount == 0) revert ZeroAmount();

        _settle(minerId);

        // 先把该用户已有的未领奖励结清，避免 shareDebt 重设造成损失
        _settleUser(minerId, msg.sender, m);

        uint256 from = m.supply;
        uint256 cost = costToBuy(from, from + amount);
        uint256 fee = (cost * FEE_BPS) / 10_000;
        uint256 total = cost + fee;
        if (msg.value < total) revert Insufficient();

        m.supply = from + amount;
        m.shareRevenue += cost;
        totalKeyValue += cost;

        shares[minerId][msg.sender] += amount;
        shareDebt[minerId][msg.sender] = Math.mulDiv(shares[minerId][msg.sender], m.accPerShare, 1e18);

        // 手续费五五分：一半给 key 所有者（矿机主人），一半进金库
        if (fee > 0) _splitFee(fee, m.owner);
        if (msg.value > total) {
            (bool ok2, ) = msg.sender.call{value: msg.value - total}("");
            if (!ok2) revert TransferFailed();
        }

        emit SharesBought(minerId, msg.sender, amount, total);
    }

    /**
     * @notice 卖出份额。按曲线回购，5% 手续费进金库
     */
    function sellShares(uint256 minerId, uint256 amount) external nonReentrant {
        Miner storage m = miners[minerId];
        if (!m.exists) revert NoMiner();
        if (amount == 0) revert ZeroAmount();

        uint256 bal = shares[minerId][msg.sender];
        if (bal < amount) revert NotYourShare();

        _settle(minerId);

        // 先结清已有份额累积的奖励，再减少份额
        _settleUser(minerId, msg.sender, m);

        uint256 from = m.supply;
        uint256 gross = costToBuy(from - amount, from);
        uint256 fee = (gross * FEE_BPS) / 10_000;
        uint256 payout = gross - fee;

        m.supply = from - amount;
        uint256 drop = m.shareRevenue > gross ? gross : m.shareRevenue;
        m.shareRevenue -= drop;
        totalKeyValue = totalKeyValue > drop ? totalKeyValue - drop : 0;

        shares[minerId][msg.sender] = bal - amount;
        shareDebt[minerId][msg.sender] = Math.mulDiv(shares[minerId][msg.sender], m.accPerShare, 1e18);

        // 卖出手续费同样五五分
        if (fee > 0) _splitFee(fee, m.owner);
        (bool ok2, ) = msg.sender.call{value: payout}("");
        if (!ok2) revert TransferFailed();

        emit SharesSold(minerId, msg.sender, amount, payout);
    }

    // ─────────────────────────── 挖矿 ───────────────────────────

    /// @notice 结算全局累积器
    function accrue() external {
        _accrue();
    }

    function _accrue() private {
        uint256 dt = block.timestamp - lastUpdate;
        if (dt == 0) return;
        uint256 reward = REWARD_PER_SEC * dt;
        uint256 cap = MAX_SUPPLY - totalMined;
        if (reward > cap) reward = cap;
        if (reward > 0) {
            totalMined += reward;
            uint256 friendPool = (reward * 3_000) / 10_000;   // 30%
            uint256 keyPool = reward - friendPool;             // 70%

            // 池子为空时把份额并入另一个池，而不是让它蒸发
            if (totalFriendUnits == 0 && totalKeyValue == 0) {
                // 两边都空：这批产出不发放，也不推进 totalMined
                // 必须同时推进 lastUpdate，否则空窗期会累积成「第一个入场者全吃」
                totalMined -= reward;
                lastUpdate = block.timestamp;
                return;
            } else if (totalFriendUnits == 0) {
                keyPool += friendPool;
                friendPool = 0;
            } else if (totalKeyValue == 0) {
                friendPool += keyPool;
                keyPool = 0;
            }

            if (friendPool > 0) {
                accFriendPerUnit += Math.mulDiv(friendPool, 1e18, totalFriendUnits);
            }
            if (keyPool > 0) {
                accKeyPerValue += Math.mulDiv(keyPool, 1e18, totalKeyValue);
            }
        }
        lastUpdate = block.timestamp;
    }

    function pendingOf(uint256 minerId) public view returns (uint256) {
        Miner storage m = miners[minerId];
        uint256 af = accFriendPerUnit;
        uint256 ak = accKeyPerValue;
        uint256 dt = block.timestamp - lastUpdate;
        if (dt > 0) {
            uint256 reward = REWARD_PER_SEC * dt;
            uint256 cap = MAX_SUPPLY - totalMined;
            if (reward > cap) reward = cap;
            uint256 friendPool = (reward * 3_000) / 10_000;
            uint256 keyPool = reward - friendPool;
            if (totalFriendUnits == 0 && totalKeyValue == 0) {
                friendPool = 0; keyPool = 0;
            } else if (totalFriendUnits == 0) {
                keyPool += friendPool; friendPool = 0;
            } else if (totalKeyValue == 0) {
                friendPool += keyPool; keyPool = 0;
            }
            if (totalFriendUnits > 0 && friendPool > 0) af += Math.mulDiv(friendPool, 1e18, totalFriendUnits);
            if (totalKeyValue > 0 && keyPool > 0) ak += Math.mulDiv(keyPool, 1e18, totalKeyValue);
        }
        uint256 ownerPart = Math.mulDiv(m.friends + 1, af - m.friendDebt, 1e18);
        uint256 keyAmt = Math.mulDiv(m.shareRevenue, ak - m.keyDebt, 1e18);
        return ownerPart + (keyAmt * ownerRatio(m.supply)) / 10_000;
    }

    function _settle(uint256 minerId) private {
        _accrue();
        Miner storage m = miners[minerId];

        uint256 friendAmt = Math.mulDiv(m.friends + 1, accFriendPerUnit - m.friendDebt, 1e18);
        uint256 keyAmt = Math.mulDiv(m.shareRevenue, accKeyPerValue - m.keyDebt, 1e18);
        m.friendDebt = accFriendPerUnit;
        m.keyDebt = accKeyPerValue;

        if (friendAmt > 0) {
            m.ownerPending += friendAmt;      // 好友池 100% 归主人
        }
        if (keyAmt > 0) {
            uint256 r = ownerRatio(m.supply);
            uint256 ownerPart = (keyAmt * r) / 10_000;
            uint256 holderPart = keyAmt - ownerPart;
            m.ownerPending += ownerPart;
            if (m.supply > 0 && holderPart > 0) {
                m.accPerShare += Math.mulDiv(holderPart, 1e18, m.supply);
            }
        }
    }

    /// @notice 领取挖矿产出
    function claim(uint256 minerId) external nonReentrant returns (uint256 amount) {
        Miner storage m = miners[minerId];
        if (!m.exists) revert NoMiner();

        _settle(minerId);

        if (msg.sender == m.owner) {
            amount += m.ownerPending;
            m.ownerPending = 0;
        }

        uint256 bal = shares[minerId][msg.sender];
        if (bal > 0) {
            uint256 acc = Math.mulDiv(bal, m.accPerShare, 1e18);
            uint256 pend = acc - shareDebt[minerId][msg.sender];
            shareDebt[minerId][msg.sender] = acc;
            amount += pend;
        }

        if (amount == 0) revert NothingToClaim();
        token.mint(msg.sender, amount);

        emit Claimed(minerId, msg.sender, amount);
    }

    // ─────────────────────────── 好友 ───────────────────────────

    // ─────────────────────────── 群组（链上） ───────────────────────────

    struct Group {
        string name;
        address creator;
        uint256 creatorMiner;   // 创建时的矿机编号，卖出后依然作为好友校验依据
        uint256 createdAt;
        bool exists;
    }

    mapping(uint256 => Group) public groups;
    mapping(address => uint256) public groupOf;                        // 创建者 → 群组 id
    mapping(uint256 => address[]) private _groupMembers;
    mapping(uint256 => mapping(address => bool)) public isGroupMember;
    uint256 public groupCount;

    event GroupCreated(uint256 indexed gid, address indexed creator, string name);
    event FriendRemoved(uint256 indexed a, uint256 indexed b);
    event GroupJoined(uint256 indexed gid, address indexed member, uint256 count);
    event GroupLeft(uint256 indexed gid, address indexed member, uint256 count);

    /// @notice 创建群组（每位矿机主人只能创建一个）
    function createGroup(string calldata name) external returns (uint256 gid) {
        if (minerOf[msg.sender] == 0) revert NoMiner();
        if (groupOf[msg.sender] != 0) revert AlreadyGroup();
        uint256 len = bytes(name).length;
        if (len == 0 || len > 32) revert BadName();

        gid = ++groupCount;
        groups[gid] = Group({
            name: name,
            creator: msg.sender,
            creatorMiner: minerOf[msg.sender],
            createdAt: block.timestamp,
            exists: true
        });
        groupOf[msg.sender] = gid;
        isGroupMember[gid][msg.sender] = true;
        _groupMembers[gid].push(msg.sender);

        emit GroupCreated(gid, msg.sender, name);
        emit GroupJoined(gid, msg.sender, 1);
    }

    /// @notice 加入群组：必须与群主是好友
    function joinGroup(uint256 gid) external {
        if (!groups[gid].exists) revert NoGroup();
        if (isGroupMember[gid][msg.sender]) revert AlreadyMember();

        uint256 myId = minerOf[msg.sender];
        if (myId == 0) revert NoMiner();
        // 用创建时的矿机编号校验好友关系：群主即使把矿机卖了，群也不会失效
        uint256 creatorId = groups[gid].creatorMiner;
        if (creatorId == 0) revert NoMiner();
        if (!_friendPairs[_pairKey(myId, creatorId)]) revert NotFriend();

        isGroupMember[gid][msg.sender] = true;
        _groupMembers[gid].push(msg.sender);
        emit GroupJoined(gid, msg.sender, _groupMembers[gid].length);
    }

    /// @notice 退出群组（创建者不可退出，需转让或留空）
    function leaveGroup(uint256 gid) external {
        if (!isGroupMember[gid][msg.sender]) revert NotMember();
        if (groups[gid].creator == msg.sender) revert NotOwner();

        isGroupMember[gid][msg.sender] = false;
        address[] storage arr = _groupMembers[gid];
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i] == msg.sender) {
                arr[i] = arr[arr.length - 1];
                arr.pop();
                break;
            }
        }
        emit GroupLeft(gid, msg.sender, arr.length);
    }

    /// @notice 兼容视图：老前端按 4 字段读取，这里保持顺序不变
    function groupsCompat(uint256 gid)
        external
        view
        returns (string memory name, address creator, uint256 createdAt, bool exists)
    {
        Group storage g = groups[gid];
        return (g.name, g.creator, g.createdAt, g.exists);
    }

    function groupMemberCount(uint256 gid) external view returns (uint256) {
        return _groupMembers[gid].length;
    }

    function groupMembers(uint256 gid) external view returns (address[] memory) {
        return _groupMembers[gid];
    }

    /// @notice 某个地址的群组概况：自己创建的 + 自己加入的
    function groupProfile(address who)
        external
        view
        returns (uint256 created, uint256 joinedCount, uint256 createdMembers)
    {
        created = groupOf[who];
        if (created != 0) createdMembers = _groupMembers[created].length;

        uint256 total = groupCount;
        for (uint256 g = 1; g <= total; g++) {
            if (isGroupMember[g][who]) joinedCount++;
        }
    }

    // ─────────────────────────── 回购销毁 ───────────────────────────

    /// @notice 设置 Pancake Router（仅 owner，renounce 前可改）
    function setRouter(address r) external onlyOwner {
        require(r != address(0), "zero addr");
        router = r;
    }

    /// @notice 真正闲置的 BNB = 余额 − key 兑付储备 − 托管负债
    /// @dev 少扣任何一项都会让 buybackAndBurn 花掉别人的钱
    function spareBnb() public view returns (uint256) {
        uint256 bal = address(this).balance;
        uint256 owed = totalKeyValue + totalEscrow;
        return bal > owed ? bal - owed : 0;
    }

    /**
     * @notice 回购并销毁：用闲置 BNB 在 DEX 买入 FRNZ 直接销毁
     * @dev 只动 spareBnb()，永远不碰 totalKeyValue 的兑付储备
     *      任何人都能触发，但资金只能来自合约闲置余额
     */
    function buybackAndBurn(uint256 bnbIn, uint256 minTokensOut) external nonReentrant {
        if (router == address(0)) revert RouterNotSet();
        if (bnbIn == 0) revert ZeroAmount();
        if (bnbIn > spareBnb()) revert TooMuchBnb();

        address[] memory path = new address[](2);
        path[0] = WBNB;
        path[1] = address(token);

        uint256[] memory outs = IRouter(router).swapExactETHForTokens{value: bnbIn}(
            minTokensOut, path, address(this), block.timestamp + 600
        );

        uint256 got = outs[outs.length - 1];
        token.burn(got);
        totalBurned += got;

        emit BuybackBurned(bnbIn, got, totalBurned);
    }

    /// @notice WBNB 地址（各链不同，部署后由 owner 设置）
    address public WBNB;

    function setWBNB(address w) external onlyOwner {
        require(w != address(0), "zero addr");
        WBNB = w;
    }

    /**
     * @notice 解除好友关系（任一方可发起）
     * @dev 双方各 -1、全网 -2；已支付的好友费不退，防止「加了再删」刷免费额度
     */
    function removeFriend(uint256 otherMiner) external {
        uint256 myId = minerOf[msg.sender];
        if (myId == 0) revert NoMiner();
        if (!miners[otherMiner].exists) revert NoMiner();
        if (!_friendPairs[_pairKey(myId, otherMiner)]) revert NotFriendPair();

        _settle(myId);
        _settle(otherMiner);

        _friendPairs[_pairKey(myId, otherMiner)] = false;
        miners[myId].friends -= 1;
        miners[otherMiner].friends -= 1;
        totalFriendUnits -= 2;

        emit FriendRemoved(myId, otherMiner);
    }

    function _pairKey(uint256 a, uint256 b) private pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function areFriends(uint256 a, uint256 b) external view returns (bool) {
        return _friendPairs[_pairKey(a, b)];
    }

    /**
     * @notice 发起好友请求。前 10 个好友免费，之后每方各付 0.1 代币
     */
    function requestFriend(uint256 toMiner) external nonReentrant returns (uint256 reqId) {
        uint256 fromId = minerOf[msg.sender];
        if (fromId == 0) revert NoMiner();
        Miner storage tm = miners[toMiner];
        if (!tm.exists) revert NoMiner();
        if (fromId == toMiner) revert SelfFriend();
        if (_friendPairs[_pairKey(fromId, toMiner)]) revert AlreadyFriends();

        reqId = ++nextReqId;
        friendReqs[reqId] = FriendReq({from: fromId, to: toMiner, toOwner: tm.owner, active: true});

        emit FriendRequested(reqId, fromId, toMiner);
    }

    /**
     * @notice 接受好友请求（双向确认，接受方同样付费）
     */
    function acceptFriend(uint256 reqId) external nonReentrant {
        FriendReq storage r = friendReqs[reqId];
        if (!r.active) revert InactiveRequest();
        if (msg.sender != r.toOwner) revert NotTarget();
        // 已经建立关系就不能再接受（防止先批量发请求、再逐条确认刷好友单位）
        if (_friendPairs[_pairKey(r.from, r.to)]) revert AlreadyFriends();
        r.active = false;

        Miner storage fm = miners[r.from];
        Miner storage tm = miners[r.to];

        // 1) 用「变更前」的属性结清历史产出，并把两个债务对齐到当前累积器
        _settle(r.from);
        _settle(r.to);

        // 2) 接受时按当时的计数双向收费（避免停在 9 个好友无限发免费请求）
        if (fm.friends >= FRIEND_FREE) token.burnFrom(fm.owner, FRIEND_COST);
        if (tm.friends >= FRIEND_FREE) token.burnFrom(tm.owner, FRIEND_COST);

        // 4) 建立关系：双方好友各 +1，全网好友单位 +2
        _friendPairs[_pairKey(r.from, r.to)] = true;
        fm.friends += 1;
        tm.friends += 1;
        totalFriendUnits += 2;

        emit FriendAccepted(r.from, r.to);
    }

    /**
     * @notice 仅供 MinerNFT 回调：转让时同步 owner 映射
     * @dev 接收方不能已经拥有矿机（一人一台的硬约束）
     */
    /// @dev 手续费五五分。给矿机主人的那半走记账，由他自己提取，
    ///      这样即使 owner 是拒收 BNB 的合约，也不会影响其他人买卖 key。
    function _splitFee(uint256 fee, address creator) private {
        uint256 toCreator = (fee * CREATOR_FEE_BPS) / 10_000;
        uint256 toTreasury = fee - toCreator;

        if (toCreator > 0 && creator != address(0)) {
            creatorCredit[creator] += toCreator;
        } else {
            toTreasury += toCreator;
        }
        if (toTreasury > 0) {
            (bool ok2, ) = treasury.call{value: toTreasury}("");
            if (!ok2) revert TransferFailed();
        }
    }

    /// @notice 提取作为矿机主人累积的手续费分成
    function withdrawCreatorCredit() external nonReentrant {
        uint256 amt = creatorCredit[msg.sender];
        if (amt == 0) revert ZeroAmount();
        creatorCredit[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amt}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev 作废该矿机的挂单与出价；出价改为记账退款
    function _clearMarket(uint256 id) private {
        delete listings[id];
        Offer memory o = bestOffer[id];
        if (o.amount > 0) {
            delete bestOffer[id];
            refundCredit[o.buyer] += o.amount;
            emit OfferRefunded(id, o.buyer, o.amount);
        }
    }

    /// @notice 提取被作废的出价退款
    function withdrawRefund() external nonReentrant {
        uint256 amt = refundCredit[msg.sender];
        if (amt == 0) revert ZeroAmount();
        refundCredit[msg.sender] = 0;
        totalEscrow -= amt;
        (bool ok, ) = msg.sender.call{value: amt}("");
        if (!ok) revert TransferFailed();
    }

    function onMinerTransfer(uint256 id, address from, address to) external {
        if (msg.sender != address(nft)) revert OnlyNFT();
        Miner storage m = miners[id];
        if (!m.exists) return;

        if (from != address(0)) delete minerOf[from];
        if (to != address(0)) {
            if (minerOf[to] != 0) revert AlreadyMiner();
            minerOf[to] = id;
        }
        m.owner = to;
        // 易主后旧的挂单与出价一律失效
        _clearMarket(id);
    }

    // ─────────────────────────── NFT 市场 ───────────────────────────

    /**
     * @notice 挂单出售自己的矿机
     * @dev 调用前必须先 nft.approve(core, id)；成交时 NFT 与未释放收益一起转给买家
     */
    function listMiner(uint256 id, uint256 price) external nonReentrant {
        if (miners[id].owner != msg.sender) revert NotOwner();
        if (price == 0) revert ZeroAmount();
        bool okApprove = nft.getApproved(id) == address(this) || nft.isApprovedForAll(msg.sender, address(this));
        if (!okApprove) revert NotApproved();

        _settle(id);   // 先把已产出的结清，避免卖家和买家纠纷
        listings[id] = Listing({seller: msg.sender, price: uint96(price), active: true});
        emit MinerListed(id, msg.sender, price);
    }

    /// @notice 撤单
    function unlistMiner(uint256 id) external {
        Listing memory L = listings[id];
        if (L.seller != msg.sender || !L.active) revert NotListed();
        delete listings[id];
        emit MinerUnlisted(id);
    }

    /**
     * @notice 买下挂单的矿机。5% 手续费进金库，其余直接给卖家
     */
    function buyMiner(uint256 id) external payable nonReentrant {
        Listing memory L = listings[id];
        if (!L.active) revert NotListed();
        if (msg.value < L.price) revert Insufficient();

        delete listings[id];

        uint256 price = L.price;
        uint256 fee = (price * MARKET_FEE_BPS) / 10_000;
        uint256 toSeller = price - fee;

        // 先转 NFT（会回调 onMinerTransfer 校验买家没有矿机）
        nft.transferFrom(L.seller, msg.sender, id);

        (bool a, ) = L.seller.call{value: toSeller}("");
        if (!a) revert TransferFailed();
        if (fee > 0) {
            (bool b, ) = treasury.call{value: fee}("");
            if (!b) revert TransferFailed();
        }
        if (msg.value > price) {
            (bool c, ) = msg.sender.call{value: msg.value - price}("");
            if (!c) revert TransferFailed();
        }

        emit MinerSold(id, L.seller, msg.sender, price);
    }

    /// @notice 查询挂单
    function listingOf(uint256 id) external view returns (address seller, uint256 price, bool active) {
        Listing memory L = listings[id];
        return (L.seller, L.price, L.active);
    }

    // ─────────────────────────── 出价 ───────────────────────────

    /**
     * @notice 对某台矿机出价，资金托管在合约里
     * @dev 必须高于当前最高价；被超价会自动全额退回上一个出价人
     */
    function makeOffer(uint256 id) external payable nonReentrant {
        Miner storage m = miners[id];
        if (!m.exists) revert NoMiner();
        if (msg.value == 0) revert ZeroAmount();

        Offer memory cur = bestOffer[id];
        if (msg.value <= cur.amount) revert OfferTooLow();

        bestOffer[id] = Offer({buyer: msg.sender, amount: uint96(msg.value)});
        // 新增托管 = 本次出价 − 退回给上一位的金额
        uint256 prev = (cur.buyer != address(0) && cur.amount > 0) ? uint256(cur.amount) : 0;
        totalEscrow = totalEscrow + msg.value - prev;

        // 退还给上一个出价人
        if (prev > 0) {
            (bool ok, ) = cur.buyer.call{value: prev}("");
            if (!ok) revert TransferFailed();
        }
        emit OfferMade(id, msg.sender, msg.value);
    }

    /// @notice 撤回自己的出价
    function cancelOffer(uint256 id) external nonReentrant {
        Offer memory cur = bestOffer[id];
        if (cur.buyer != msg.sender || cur.amount == 0) revert NoOffer();
        delete bestOffer[id];
        totalEscrow -= uint256(cur.amount);
        (bool ok, ) = msg.sender.call{value: cur.amount}("");
        if (!ok) revert TransferFailed();
        emit OfferCancelled(id, msg.sender);
    }

    /**
     * @notice 主人接受最高出价：NFT 转给买家，95% 给主人，5% 进金库
     * @dev 调用前矿机主人必须先 nft.approve(core, id)
     */
    function acceptOffer(uint256 id) external nonReentrant {
        if (miners[id].owner != msg.sender) revert NotOwner();
        Offer memory cur = bestOffer[id];
        if (cur.amount == 0) revert NoOffer();

        bool okApprove = nft.getApproved(id) == address(this) || nft.isApprovedForAll(msg.sender, address(this));
        if (!okApprove) revert NotApproved();

        _settle(id);
        delete bestOffer[id];
        totalEscrow -= uint256(cur.amount);

        uint256 price = cur.amount;
        uint256 fee = (price * MARKET_FEE_BPS) / 10_000;
        uint256 toSeller = price - fee;

        nft.transferFrom(msg.sender, cur.buyer, id);

        (bool a, ) = msg.sender.call{value: toSeller}("");
        if (!a) revert TransferFailed();
        if (fee > 0) {
            (bool b, ) = treasury.call{value: fee}("");
            if (!b) revert TransferFailed();
        }
        emit OfferAccepted(id, cur.buyer, price);
    }

    /// @notice 查询最高出价
    function offerOf(uint256 id) external view returns (address buyer, uint256 amount) {
        Offer memory o = bestOffer[id];
        return (o.buyer, o.amount);
    }

    // ─────────────────────────── 平台 ───────────────────────────

    /// @notice 平台用收入回购后销毁
    function burnTokens(uint256 amount) external {
        token.burnFrom(msg.sender, amount);
    }
}

/// @dev Pancake Router 最小接口
interface IRouter {
    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);
}
