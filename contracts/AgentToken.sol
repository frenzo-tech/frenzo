// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentToken ($ACT)
 * @notice 挖矿产出的唯一来源。总量 10 亿，由 CityCore 按秒铸造。
 *         平台不预留任何份额 —— 100% 靠挖矿产出。
 */
contract AgentToken is ERC20, Ownable {
    /// @dev 硬上限，1 亿枚
    uint256 public constant MAX_SUPPLY = 100_000_000e18;

    /// @dev 唯一有权铸币的合约（CityCore）
    address public minter;

    error NotMinter();
    error CapExceeded();

    event MinterSet(address indexed minter);

    constructor() ERC20("Frenzo", "FRNZ") Ownable(msg.sender) {}

    modifier onlyMinter() {
        if (msg.sender != minter) revert NotMinter();
        _;
    }

    /// @notice 设置铸币合约，只能设置一次
    function setMinter(address m) external onlyOwner {
        require(m != address(0), "zero addr");
        require(minter == address(0), "already set");
        minter = m;
        emit MinterSet(m);
    }

    /// @notice 只有 CityCore 能调用
    function mint(address to, uint256 amount) external onlyMinter {
        if (totalSupply() + amount > MAX_SUPPLY) revert CapExceeded();
        _mint(to, amount);
    }

    /// @notice 任何人都能烧自己的币（用于回购销毁 / 好友费销毁）
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /// @notice 授权额度内代扣并销毁（好友费用）
    function burnFrom(address from, uint256 amount) external {
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
    }
}
