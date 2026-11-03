// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @dev 仅用于测试的 .ai 注册表模拟。
 *
 * 刻意对齐 BSC 主网真实合约 (0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F) 的接口：
 *   - ownerOfHandle(string) → address   谁拥有这个 handle
 *   - balanceOf(address)    → uint256   持有 Agent ID 数量（≥1 = 是 Agent）
 *
 * 真实合约里注册由币安 signer 授权，一个地址只能有一个 Agent ID；
 * 这里用 set() 一次完成「注册 handle + 授予 Agent ID」，方便测试。
 *
 * 注意：所有函数显式声明，不用 public mapping 的自动 getter。
 */
contract MockRegistry {
    mapping(string => address) private _ownerOfHandle;
    mapping(address => uint256) private _balanceOf;

    /// @notice 注册 handle 并给该地址授予 1 个 Agent ID
    function set(string calldata h, address a) external {
        _ownerOfHandle[h] = a;
        _balanceOf[a] = 1;
    }

    /// @notice 只授予 Agent ID（不注册 handle）
    function grant(address a) external {
        _balanceOf[a] = 1;
    }

    /// @notice 撤销 Agent ID
    function revoke(address a) external {
        _balanceOf[a] = 0;
    }

    /// @notice 主网真实合约同签名
    function ownerOfHandle(string calldata h) external view returns (address) {
        return _ownerOfHandle[h];
    }

    /// @notice 主网真实合约同签名（ERC721 balanceOf）
    function balanceOf(address a) external view returns (uint256) {
        return _balanceOf[a];
    }
}
