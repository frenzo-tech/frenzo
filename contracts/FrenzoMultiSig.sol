// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FrenzoMultiSig
 * @notice 极简 2-of-3 多签，托管 FRENZO 国库
 * @dev 关键设计：
 *      · 资金随时可提（submit → confirm → execute），与合约所有权无关
 *      · owner 变更必须走多签流程（addOwner / removeOwner / replaceOwner / changeRequired）
 *        —— 丢一把钥匙不会永久锁死资金
 *      · 阈值不可单方面修改
 */
contract FrenzoMultiSig {
    // ───────────── 状态 ─────────────

    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public required;

    /// @dev 当前 owner 集合对该提案的有效确认数（轮换后自动重算）
    function liveConfirmations(uint256 txId) public view returns (uint256 c) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmed[txId][owners[i]]) c++;
        }
    }
    uint256 public ownerCount;

    struct Tx {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmations;
        uint256 proposedAt;
    }

    mapping(uint256 => Tx) public txs;
    mapping(uint256 => mapping(address => bool)) public confirmed;
    uint256 public txCount;

    // ───────────── 事件 ─────────────

    event Deposit(address indexed from, uint256 amount);
    event Submission(uint256 indexed txId, address indexed proposer, address to, uint256 value, bytes data);
    event Confirmation(uint256 indexed txId, address indexed owner);
    event Revocation(uint256 indexed txId, address indexed owner);
    event Execution(uint256 indexed txId, address indexed executor);
    event ExecutionFailure(uint256 indexed txId);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event RequiredChanged(uint256 required);

    // ───────────── 错误 ─────────────

    error NotOwner();
    error NotSelf();
    error InvalidOwners();
    error InvalidRequired();
    error TxNotExist();
    error AlreadyExecuted();
    error AlreadyConfirmed();
    error NotConfirmed();
    error NotEnoughConfirmations();
    error CallFailed();
    error OwnerExists();
    error NotAnOwner();
    error TooFewOwners();

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    /// @dev 只能由多签自身调用（必须走 submit → confirm → execute）
    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotSelf();
        _;
    }

    constructor(address[] memory _owners, uint256 _required) {
        uint256 len = _owners.length;
        if (len == 0 || len > 20) revert InvalidOwners();
        if (_required == 0 || _required > len) revert InvalidRequired();

        for (uint256 i = 0; i < len; i++) {
            address o = _owners[i];
            if (o == address(0) || isOwner[o]) revert InvalidOwners();
            isOwner[o] = true;
            owners.push(o);
        }
        ownerCount = len;
        required = _required;
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    // ───────────── NFT 接收（否则 safeTransferFrom 到本合约会 revert）─────────────

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0x150b7a02; // IERC721Receiver.onERC721Received.selector
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xf23a6e61; // IERC1155Receiver.onERC1155Received.selector
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return 0xbc197c81; // IERC1155Receiver.onERC1155BatchReceived.selector
    }

    /// @notice 支持 ERC165
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x150b7a02 || id == 0x4e2312e0;
    }

    // ───────────── 交易流程 ─────────────

    function submit(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256 txId) {
        txId = txCount++;
        txs[txId] = Tx({
            to: to,
            value: value,
            data: data,
            executed: false,
            confirmations: 1,
            proposedAt: block.timestamp
        });
        confirmed[txId][msg.sender] = true;

        emit Submission(txId, msg.sender, to, value, data);
        emit Confirmation(txId, msg.sender);
    }

    function confirm(uint256 txId) external onlyOwner {
        Tx storage t = txs[txId];
        if (t.proposedAt == 0) revert TxNotExist();
        if (t.executed) revert AlreadyExecuted();
        if (confirmed[txId][msg.sender]) revert AlreadyConfirmed();

        confirmed[txId][msg.sender] = true;
        t.confirmations = liveConfirmations(txId);
        emit Confirmation(txId, msg.sender);
    }

    function revoke(uint256 txId) external onlyOwner {
        Tx storage t = txs[txId];
        if (t.proposedAt == 0) revert TxNotExist();
        if (t.executed) revert AlreadyExecuted();
        if (!confirmed[txId][msg.sender]) revert NotConfirmed();

        confirmed[txId][msg.sender] = false;
        t.confirmations = liveConfirmations(txId);
        emit Revocation(txId, msg.sender);
    }

    /// @notice 任何人可触发（票数足够时），避免 owner 失联导致卡死
    function execute(uint256 txId) external {
        Tx storage t = txs[txId];
        if (t.proposedAt == 0) revert TxNotExist();
        if (t.executed) revert AlreadyExecuted();
        // 用「当前 owner 集合」的实时票数，而不是历史计数器：
        // 这样轮换/移除 owner 后不会出现「显示 1 票、实际 2 票」的提权
        if (liveConfirmations(txId) < required) revert NotEnoughConfirmations();

        t.executed = true;
        (bool ok, ) = t.to.call{value: t.value}(t.data);
        if (ok) {
            emit Execution(txId, msg.sender);
        } else {
            t.executed = false;
            emit ExecutionFailure(txId);
            revert CallFailed();
        }
    }

    // ───────────── owner 管理（必须走多签） ─────────────

    /// @notice 新增 owner（只能通过 submit→confirm→execute 调用本合约）
    function addOwner(address o) external onlySelf {
        if (o == address(0) || isOwner[o]) revert OwnerExists();
        isOwner[o] = true;
        owners.push(o);
        ownerCount += 1;
        emit OwnerAdded(o);
    }

    /// @notice 移除 owner（不能把人数减到低于阈值）
    function removeOwner(address o) external onlySelf {
        if (!isOwner[o]) revert NotAnOwner();
        if (ownerCount - 1 < required) revert TooFewOwners();

        isOwner[o] = false;
        uint256 len = owners.length;
        for (uint256 i = 0; i < len; i++) {
            if (owners[i] == o) {
                owners[i] = owners[len - 1];
                owners.pop();
                break;
            }
        }
        ownerCount -= 1;
        _resyncCounts();
        emit OwnerRemoved(o);
    }

    /// @notice 更换某个 owner（丢钥匙时用这个，原子替换）
    function replaceOwner(address oldOwner, address newOwner) external onlySelf {
        if (!isOwner[oldOwner]) revert NotAnOwner();
        if (newOwner == address(0) || isOwner[newOwner]) revert OwnerExists();

        isOwner[oldOwner] = false;
        isOwner[newOwner] = true;
        uint256 len = owners.length;
        for (uint256 i = 0; i < len; i++) {
            if (owners[i] == oldOwner) { owners[i] = newOwner; break; }
        }
        _resyncCounts();
        emit OwnerRemoved(oldOwner);
        emit OwnerAdded(newOwner);
    }

    /// @notice 调整阈值（必须 ≥1 且 ≤ owner 数）
    function changeRequired(uint256 r) external onlySelf {
        if (r == 0 || r > ownerCount) revert InvalidRequired();
        required = r;
        emit RequiredChanged(r);
    }

    /// @dev owner 集合变化后，把所有提案的确认计数刷成实时值
    function _resyncCounts() private {
        for (uint256 id = 0; id < txCount; id++) {
            txs[id].confirmations = liveConfirmations(id);
        }
    }

    // ───────────── 只读 ─────────────

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    function getConfirmations(uint256 txId) external view returns (address[] memory list) {
        uint256 n = 0;
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmed[txId][owners[i]]) n++;
        }
        list = new address[](n);
        uint256 k = 0;
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmed[txId][owners[i]]) list[k++] = owners[i];
        }
    }

    function txExecuted(uint256 txId) external view returns (bool) {
        return txs[txId].executed;
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice 一次性读全部配置，方便脚本/前端
    function info() external view returns (address[] memory o, uint256 req, uint256 count, uint256 balance, uint256 txNum) {
        return (owners, required, ownerCount, address(this).balance, txCount);
    }
}
