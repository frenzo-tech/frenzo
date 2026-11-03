// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/**
 * @title MinerNFT
 * @notice 一台矿机 = 一个 NFT。一个 .ai handle 只能铸造一次。
 *         矿机的属性、好友、份额都记录在 CityCore 里，这个合约只负责所有权。
 */
interface ICoreHook {
    function onMinerTransfer(uint256 id, address from, address to) external;
}

contract MinerNFT is ERC721 {
    using Strings for uint256;
    /// @dev 核心合约，唯一可以 mint / burn 的地址
    address public core;

    /// @dev 下一个 tokenId
    uint256 public nextId = 1;

    /// @dev tokenId => .ai handle（不含 .ai 后缀）
    mapping(uint256 => string) public handleOf;

    /// @dev handle 是否已被铸造（防重复）
    mapping(bytes32 => bool) public handleUsed;

    error OnlyCore();
    error HandleTaken();
    error BadHandle();          // handle 字符集非法
    error HandleTooLong();      // 超过 24 字节

    event CoreSet(address indexed core);

    /// @notice 部署者，仅用于首次绑定 core
    address public immutable deployer;

    constructor() ERC721("Frenzo Miner", "FRNZM") {
        deployer = msg.sender;
    }

    modifier onlyCore() {
        if (msg.sender != core) revert OnlyCore();
        _;
    }

    /// @notice 一次性绑定核心合约
    function setCore(address c) external {
        require(msg.sender == deployer, "only deployer");
        require(core == address(0), "already set");
        require(c != address(0), "zero addr");
        core = c;
        emit CoreSet(c);
    }

    /**
     * @notice handle 字符集校验
     * @dev 只允许 a-z 0-9 和连字符，1–24 字节。
     *      这是为了防止链上字符串投毒：handle 会进入 tokenURI 的 name 字段，
     *      任何读 NFT 元数据的 AI / 市场都会消费它。放任任意文本 = 允许别人
     *      把提示词注入写进我们的元数据，且永久留在链上。
     *      也对齐 SPACE ID 的 handle 规则。
     */
    function _validHandle(string memory h) internal pure returns (bool) {
        bytes memory b = bytes(h);
        if (b.length == 0) return false;
        if (b.length > 24) return false;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 ch = b[i];
            bool okChar = (ch >= 0x61 && ch <= 0x7a)   // a-z
                       || (ch >= 0x30 && ch <= 0x39)   // 0-9
                       || (ch == 0x2d);                 // -
            if (!okChar) return false;
        }
        return true;
    }

    /// @notice 只读校验，供前端/Agent 预检查
    function isValidHandle(string calldata h) external pure returns (bool) {
        return _validHandle(h);
    }

    /// @notice 铸造一台矿机
    function mint(address to, string calldata handle) external onlyCore returns (uint256 id) {
        if (!_validHandle(handle)) revert BadHandle();
        bytes32 h = keccak256(bytes(handle));
        if (handleUsed[h]) revert HandleTaken();
        handleUsed[h] = true;

        id = nextId++;
        handleOf[id] = handle;
        _mint(to, id);
    }

    /// @notice 销毁（用于矿机弃置）
    function burn(uint256 id) external onlyCore {
        _burn(id);
    }

    /// @dev 转让/销毁时回调 Core，保持 owner 映射一致
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        address c = core;
        if (from != address(0) && c != address(0)) {
            ICoreHook(c).onMinerTransfer(tokenId, from, to);
        }
        return super._update(to, tokenId, auth);
    }

    // ─────────────────────────── 链上元数据 ───────────────────────────

    // ─────────────────────────── 链上形象 ───────────────────────────

    /// @dev 4 档肤色、6 档发色、6 档服装、8 组背景
    string[4] private SKIN = ["#f6d3b8", "#e8b894", "#c98a63", "#8d5638"];
    string[4] private SKIN_DARK = ["#e2b696", "#d29d78", "#ab7150", "#6f4128"];
    string[6] private HAIR = ["#1f2430", "#3b2a21", "#6b4a2f", "#a8642a", "#c9a227", "#d8d8e0"];
    string[6] private OUTFIT = ["#7c5cff", "#00b3a4", "#ff6b6b", "#f59e0b", "#3b82f6", "#a855f7"];
    string[8] private BG = ["#7c5cff,#00d4ff", "#ff6b6b,#ffc247", "#00d4a0,#3b82f6", "#a855f7,#ec4899", "#f59e0b,#ef4444", "#22d3ee,#a3e635", "#6366f1,#f472b6", "#14b8a6,#8b5cf6"];

    /// @notice 静态外观参数（铸造时由种子决定，永不变化）
    struct Face {
        bool female;
        uint8 skin;
        uint8 hair;
        uint8 outfit;
        uint8 bg;
        uint8 accessory; // 0 无 1 眼镜 2 耳机 3 皇冠
    }

    function faceOf(uint256 id) public view returns (Face memory) {
        bytes32 seed = keccak256(abi.encodePacked(id, handleOf[id]));
        uint256 s = uint256(seed);
        return Face({
            female: (s & 1) == 1,
            skin: uint8((s >> 1) % 4),
            hair: _hairIdx((s >> 5) % 100),
            outfit: uint8((s >> 13) % 6),
            bg: uint8((s >> 17) % 8),
            accessory: _accIdx((s >> 21) % 100)
        });
    }

    /// @dev 发色权重：黑 25 / 棕 22 / 赤褐 20 / 金 18 / 深棕 10 / 银 5
    function _hairIdx(uint256 r) private pure returns (uint8) {
        if (r < 25) return 0;
        if (r < 47) return 1;
        if (r < 67) return 2;
        if (r < 85) return 3;
        if (r < 95) return 4;
        return 5;
    }

    /// @dev 配饰权重：无 60 / 眼镜 20 / 耳机 15 / 皇冠 5
    function _accIdx(uint256 r) private pure returns (uint8) {
        if (r < 60) return 0;
        if (r < 80) return 1;
        if (r < 95) return 2;
        return 3;
    }

    /**
     * @notice 链上生成 3D 质感角色立绘
     * @dev 全部为椭圆/圆角矩形 + 径向渐变，模拟柔和体积光
     */
    function _portrait(uint256 id, string memory h) private view returns (string memory) {
        Face memory f = faceOf(id);
        string memory gid = string.concat("bg", id.toString());
        string memory sk = SKIN[f.skin];
        string memory skd = SKIN_DARK[f.skin];
        string memory hair = HAIR[f.hair];
        string memory fit = OUTFIT[f.outfit];

        string memory hairBack = f.female
            ? string.concat(
                '<ellipse cx="250" cy="232" rx="110" ry="118" fill="', hair, '"/>',
                '<rect x="128" y="240" width="46" height="180" rx="23" fill="', hair, '"/>',
                '<rect x="326" y="240" width="46" height="180" rx="23" fill="', hair, '"/>'
              )
            : '<ellipse cx="250" cy="246" rx="116" ry="122" fill="' ;
        if (!f.female) {
            hairBack = string.concat(hairBack, hair, '"/>');
        }

        string memory hairFront = f.female
            ? string.concat(
                '<path d="M152 218 Q250 90 348 218 Q348 132 250 118 Q152 132 152 218 Z" fill="', hair, '"/>',
                '<ellipse cx="250" cy="150" rx="70" ry="34" fill="', hair, '" opacity="0.65"/>'
              )
            : string.concat(
                '<path d="M158 212 Q250 96 342 212 Q342 142 250 130 Q158 142 158 212 Z" fill="', hair, '"/>',
                '<path d="M150 206 Q168 150 200 176 Q176 190 150 206 Z" fill="', hair, '" opacity="0.8"/>'
              );

        string memory acc = "";
        if (f.accessory == 1) {
            acc = string.concat(
                '<rect x="176" y="228" width="60" height="40" rx="18" fill="none" stroke="#e6e6ea" stroke-width="5"/>',
                '<rect x="264" y="228" width="60" height="40" rx="18" fill="none" stroke="#e6e6ea" stroke-width="5"/>',
                '<rect x="236" y="244" width="28" height="5" fill="#e6e6ea"/>'
            );
        } else if (f.accessory == 2) {
            acc = string.concat(
                '<path d="M150 236 Q118 236 112 292 Q108 330 140 338" fill="none" stroke="', fit, '" stroke-width="14" stroke-linecap="round"/>',
                '<path d="M350 236 Q382 236 388 292 Q392 330 360 338" fill="none" stroke="', fit, '" stroke-width="14" stroke-linecap="round"/>'
            );
        } else if (f.accessory == 3) {
            acc = string.concat(
                '<path d="M182 118 L206 74 L232 112 L250 66 L268 112 L294 74 L318 118 Z" fill="#ffc247"/>'
            );
        }

        string memory svgStr = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500">',
            '<defs>',
            '<radialGradient id="', gid, '" cx="35%" cy="28%">',
            '<stop offset="0%" stop-color="', _split(BG[f.bg], 0), '"/>',
            '<stop offset="100%" stop-color="', _split(BG[f.bg], 1), '"/>',
            '</radialGradient>',
            '<radialGradient id="skin" cx="38%" cy="30%">',
            '<stop offset="0%" stop-color="', sk, '"/><stop offset="100%" stop-color="', skd, '"/>',
            '</radialGradient>',
            '<linearGradient id="fit" x1="0" y1="0" x2="0" y2="1">',
            '<stop offset="0%" stop-color="', fit, '"/><stop offset="100%" stop-color="#2a2f3d"/>',
            '</linearGradient>',
            '</defs>',
            '<rect width="500" height="500" fill="#0a0c12"/>',
            '<rect x="0" y="0" width="500" height="500" fill="url(#', gid, ')" opacity="0.28"/>',
            '<circle cx="250" cy="250" r="210" fill="url(#', gid, ')" opacity="0.18"/>',
            // 肩膀
            '<ellipse cx="250" cy="500" rx="196" ry="150" fill="url(#fit)"/>',
            '<ellipse cx="250" cy="486" rx="150" ry="86" fill="#ffffff" opacity="0.06"/>',
            // 脖子
            '<rect x="226" y="296" width="48" height="66" rx="22" fill="', skd, '"/>',
            // 后发
            hairBack,
            // 头
            '<ellipse cx="250" cy="238" rx="106" ry="118" fill="url(#skin)"/>',
            '<ellipse cx="214" cy="196" rx="46" ry="34" fill="#ffffff" opacity="0.16"/>',
            // 前发
            hairFront,
            // 眉
            '<rect x="196" y="224" width="38" height="7" rx="3.5" fill="', hair, '" opacity="0.85"/>',
            '<rect x="266" y="224" width="38" height="7" rx="3.5" fill="', hair, '" opacity="0.85"/>',
            // 眼
            '<ellipse cx="215" cy="252" rx="15" ry="17" fill="#ffffff"/>',
            '<ellipse cx="285" cy="252" rx="15" ry="17" fill="#ffffff"/>',
            '<circle cx="217" cy="254" r="8" fill="#1b1f2a"/>',
            '<circle cx="287" cy="254" r="8" fill="#1b1f2a"/>',
            '<circle cx="220" cy="251" r="2.6" fill="#ffffff"/>',
            '<circle cx="290" cy="251" r="2.6" fill="#ffffff"/>',
            // 腮红与嘴
            '<ellipse cx="188" cy="284" rx="18" ry="10" fill="#ff8a8a" opacity="0.28"/>',
            '<ellipse cx="312" cy="284" rx="18" ry="10" fill="#ff8a8a" opacity="0.28"/>',
            '<path d="M234 296 Q250 308 266 296" fill="none" stroke="#8a4a44" stroke-width="5" stroke-linecap="round"/>',
            acc,
            // 名字
            '<rect x="0" y="408" width="500" height="92" fill="#080a10" opacity="0.72"/>',
            '<text x="34" y="452" font-family="monospace" font-size="38" font-weight="700" fill="#ffffff">',
            h, '.ai</text>',
            '<text x="34" y="482" font-family="monospace" font-size="16" fill="#8b94a6">MINER #',
            id.toString(), f.female ? ' / FEMALE' : ' / MALE', '</text>',
            '</svg>'
        );
        return svgStr;
    }

    /// @notice 静态属性表（marketplace 可读），动态数据请查 CityCore
    function traitJson(uint256 id) public view returns (string memory) {
        Face memory f = faceOf(id);
        return string.concat(
            '[{"trait_type":"Gender","value":"', f.female ? "Female" : "Male", '"},',
            '{"trait_type":"Skin","value":"', _skinName(f.skin), '"},',
            '{"trait_type":"Hair","value":"', _hairName(f.hair), '"},',
            '{"trait_type":"Outfit","value":"', _outfitName(f.outfit), '"},',
            '{"trait_type":"Accessory","value":"', _accName(f.accessory), '"}]'
        );
    }

    function _skinName(uint8 i) private pure returns (string memory) {
        string[4] memory a = ["Fair", "Light", "Tan", "Deep"];
        return a[i];
    }
    function _hairName(uint8 i) private pure returns (string memory) {
        string[6] memory a = ["Black", "Brown", "Gold", "Rose", "Blue", "Silver"];
        return a[i];
    }
    function _outfitName(uint8 i) private pure returns (string memory) {
        string[6] memory a = ["Violet", "Teal", "Coral", "Amber", "Azure", "Orchid"];
        return a[i];
    }
    function _accName(uint8 i) private pure returns (string memory) {
        string[4] memory a = ["None", "Glasses", "Headset", "Crown"];
        return a[i];
    }

    /// @notice 完整 tokenURI
    /// @notice 批量读取 handle（前端一次性取全量，不必逐台调用）
    function handlesBatch(uint256 from, uint256 count) external view returns (string[] memory out) {
        if (count > 200) count = 200;
        if (from == 0) from = 1;
        uint256 end = from + count;
        if (end > nextId) end = nextId;
        if (end <= from) return new string[](0);
        out = new string[](end - from);
        for (uint256 i = 0; i < out.length; i++) out[i] = handleOf[from + i];
    }

    /// @notice 图片与 3D 查看器都由 https://frenzo.tech 托管
    string public baseImageURI = "https://frenzo.tech/nft/poster/";
    string public baseViewerURI = "https://frenzo.tech/viewer/?id=";

    function setBaseURI(string calldata img, string calldata viewer) external {
        if (msg.sender != core) revert OnlyCore();
        baseImageURI = img;
        baseViewerURI = viewer;
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        string memory h = handleOf[id];
        string memory sid = id.toString();
        string memory json = Base64.encode(
            bytes(
                string.concat(
                    '{"name":"', h, '.ai Miner #', sid,
                    '","description":"Frenzo miner. Power comes from frens and keys.",',
                    '"image":"', baseImageURI, sid, '.png",',
                    '"animation_url":"', baseViewerURI, sid, '",',
                    '"external_url":"https://frenzo.tech",',
                    '"attributes":', traitJson(id), '}'
                )
            )
        );
        return string.concat("data:application/json;base64,", json);
    }

    /// @dev 取调色板第 i 个颜色
    function _split(string memory s, uint256 i) private pure returns (string memory) {
        bytes memory b = bytes(s);
        uint256 start = 0;
        uint256 found = 0;
        for (uint256 k = 0; k < b.length; k++) {
            if (b[k] == ",") {
                if (found == i) return _sub(b, start, k);
                found++;
                start = k + 1;
            }
        }
        return _sub(b, start, b.length);
    }

    function _sub(bytes memory b, uint256 from, uint256 to) private pure returns (string memory) {
        bytes memory out = new bytes(to - from);
        for (uint256 k = from; k < to; k++) out[k - from] = b[k];
        return string(out);
    }
}
