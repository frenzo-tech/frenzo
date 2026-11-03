# FRENZO NFT · 机甲全身像提示词

替代上一版的「头肩半身」，改为完整站立全身。

---

## 一、主提示词（给 Grok / Midjourney / Flux）

```
A futuristic mecha character, FULL BODY, standing straight, front view, entire figure
visible from antenna tip to boot soles with a small margin all around.

SILHOUETTE
Stylized humanoid robot, proportions roughly 1:6.5 head-to-body — heroic but not
over-muscled. Broad armored shoulders, narrow waist, sturdy legs. Symmetrical A-pose:
arms relaxed at the sides, palms facing inward, feet flat and parallel, slight stance width.
Readable silhouette at thumbnail size: the shoulder and hip plates are the widest points.

HEAD
Angular helmet: flat top, straight vertical sides, jaw tapering to a narrow chin.
Wide horizontal visor band with a luminous purple-to-white-to-cyan gradient and thin
vertical scanline slots. Two white specular glints on the upper-left of the visor.
A dark chin plate below the visor with four small accent-colored vent slots.
Two vertical ear units on the helmet sides, each with a glowing LED.
One thin antenna from the upper right, tipped with a glowing orb and soft halo.

TORSO
Layered chest armor with a central hexagonal power core glowing in the accent color.
Separate collarbone plates, a segmented abdominal section of three stacked bands,
and a narrow mechanical waist joint.

ARMS
Rounded pauldrons over the shoulders, segmented upper arms, articulated elbow joints,
forearm gauntlets slightly flared at the wrist, and blocky three-fingered mechanical hands.

LEGS
Hip skirt plates on both sides, armored thighs, exposed knee joints with hydraulic
details, shin guards with a raised center ridge, and heavy boots with a distinct toe plate
and heel block.

MATERIAL
Brushed titanium and gunmetal, soft anisotropic reflections. Multi-stop metal gradient:
near-white highlight top-left, mid silver body, deep graphite shadow bottom-right.
Satin finish, subtle surface wear and panel seams. Accent panels in a saturated color
with a slight plastic sheen.

LIGHTING
Cinematic three-quarter key light from the upper left, cool cyan rim light tracing the
right edge of the whole figure, soft ambient fill. Gentle bloom on the visor, core, LEDs.
A soft contact shadow directly under the feet.

BACKGROUND
Deep navy to near-black radial gradient. A faint large circle outline centered behind the
figure, plus horizontal grid lines at 8% opacity.

STYLE
Clean modern vector-illustration meets 3D render, semi-flat shading with soft gradients,
crisp geometry, high contrast, premium collectible NFT art. Not photoreal, not chibi,
not anime.

FRAMING
Square 1:1. The figure fills about 82% of the frame height, perfectly centered,
with clear empty margin above the antenna and below the boots.
No text, no logo, no watermark, no nameplate, no scenery, no ground plane texture.
```

**参数**：`--ar 1:1 --style raw --q 2`

---

## 二、中文版

```
未来机甲角色，全身，正面站立，从天线顶端到靴底完整可见，四周留少量余白。

轮廓：风格化人形机器人，头身比约 1:6.5，英挺但不过度肌肉化。
宽肩甲、窄腰、结实的腿。对称 A 字站姿，双臂自然垂在身侧，
掌心朝内，双脚平放平行，站距略宽。缩略图下剪影清晰——肩甲和胯甲是最宽的部位。

头部：棱角分明的头盔，平顶、两侧竖直、下颌收窄成尖下巴。
横跨眼部的宽护目镜，紫→白→青发光渐变，内有细密竖向扫描槽，
左上角两道白色高光。护目镜下方深色下巴护板，开四个发强调色光的小散热槽。
头盔两侧竖向耳部单元，各带发光指示灯。右上方一根细天线，顶端小球发光带柔光晕。

躯干：层叠胸甲，正中央六边形能量核心发出强调色光。
独立锁骨护板、三段式分段腹甲、窄机械腰关节。

手臂：圆润肩甲、分段上臂、可动肘关节、前臂护手在腕部微微外扩、
方块状三指机械手。

腿部：两侧胯甲、装甲大腿、外露膝关节带液压细节、
小腿护甲带凸起中脊、厚重靴子有明显的前掌与后跟块。

材质：拉丝钛金属与枪灰，柔和各向异性反射。多段金属渐变——
左上接近白色的高光、中间银灰主体、右下深石墨阴影。
哑光质感，有轻微磨损与分模线。强调色护板带轻微塑料光泽。

光照：左上方三点式主光，冷青色轮廓光沿整个身体右缘描边，
柔和环境补光。护目镜、核心、指示灯带轻微辉光。双脚正下方有柔和接触阴影。

背景：深海军蓝到近黑的径向渐变。身后一圈极淡的大圆轮廓线，
8% 透明度的细横线网格。

风格：现代矢量插画结合 3D 渲染，半平面着色加柔和渐变，几何利落，高对比，
高级收藏级 NFT 品质。不要写实、不要 Q 版、不要日漫风。

构图：正方形 1:1。人物占画面高度约 82%，完全居中，
天线之上和靴底之下都有明显留白。
不要文字、不要 logo、不要水印、不要名牌、不要场景、不要地面纹理。
```

---

## 三、负面提示词

```
cropped head, bust only, half body, cut off legs, cut off feet, multiple characters,
character sheet grid, T-pose, arms raised, dynamic action pose, running, jumping,
photorealistic human, skin, cartoon eyes, chibi, super deformed, anime girl,
egg-shaped head, round helmet, text, letters, watermark, logo, nameplate,
scenery, floor texture, grass, city, wires, cape, weapons, extra limbs,
asymmetric design, low contrast, washed out
```

---

## 四、属性替换词（全身版）

| 属性 | 取值 | 替换词 |
|---|---|---|
| **Outfit（强调色）** | Violet | `violet-purple accent panels, violet power core` |
| | Teal | `teal-green accent panels, teal power core` |
| | Coral | `warm coral-red accent panels, coral power core` |
| | Amber | `amber-orange accent panels, amber power core` |
| | Azure | `azure-blue accent panels, azure power core` |
| | Orchid | `orchid-magenta accent panels, orchid power core` |
| **Hair（头盖 + 肩甲金属）** | Black | `black ceramic top plate and pauldrons` |
| | Brown | `bronze top plate and pauldrons` |
| | Gold | `gold-plated top plate and pauldrons` |
| | Rose | `rose-gold top plate and pauldrons` |
| | Blue | `cobalt top plate and pauldrons` |
| | Silver | `brushed silver top plate and pauldrons` |
| **Skin（机体金属光泽）** | Fair | `bright polished chrome chassis` |
| | Light | `light silver chassis` |
| | Tan | `warm gunmetal chassis` |
| | Deep | `dark graphite chassis` |
| **Gender（体型差异）** | Female | `slimmer build, narrower shoulders, longer legs, taller crown` |
| | Male | `broader shoulders, heavier chest plate, wider stance` |
| **Accessory** | Visor | 默认（护目镜即配饰） |
| | Headset | `add large over-ear headphone units on the helmet sides` |
| | Crown | `add a small angular gold crown floating above the helmet` |
| | None | `remove the antenna, plain visor` |

---

## 五、给 3D 工具的提示词（全身）

Grok 出图后喂给 **Meshy / Tripo / Rodin**：

```
A single stylized humanoid mecha character, full body, standing upright in a neutral A-pose,
arms relaxed at the sides, feet flat and parallel.

CLEAN SINGLE OBJECT
One character only, isolated on plain neutral mid-grey background, no scenery, no floor shadow,
no props, no weapon, no cape.

GEOMETRY
Hard-surface, game-ready, low-to-mid poly. Separate pieces so they can be rigged:
helmet shell, visor, chin vent plate, two ear units, antenna, chest plate, power core,
three abdominal segments, two pauldrons, upper arms, forearms, hands,
hip skirt plates, thighs, knee joints, shins, boots.
Clean quad topology, beveled hard edges, no messy boolean intersections.

PROPORTIONS
Head-to-body ratio about 1:6.5. Total height exactly 2.0 meters for scale reference.
Shoulder pauldrons are the widest point. Symmetric.

MATERIALS (PBR)
· Chassis: brushed titanium, metallic 0.95, roughness 0.35, anisotropic highlights
· Top plate and pauldrons: colored metal, metallic 0.9, roughness 0.30
· Accent panels: saturated plastic, metallic 0.1, roughness 0.4
· Visor: emissive gradient purple→white→cyan, emission 2.5, clearcoat layer
· Power core, ear LEDs, antenna tip: emissive accent color, strength 4.0
· Joints and hydraulics: dark steel, metallic 0.9, roughness 0.55

RIGGING
Provide a simple humanoid skeleton: spine, neck, head, two arms, two legs.
T-pose bind pose is fine for the export, A-pose for the reference render.

RENDER SETUP
Three-point studio lighting: key upper-left, cool rim right, soft fill.
Dark background for the beauty shot.

OUTPUT
GLB format, single mesh hierarchy, no baked text, no watermark, feet on Y=0.
```

**操作顺序**

```
1. 正面正交全身图 → 生成基础网格（保证左右对称、比例正确）
2. 侧面正交图 → 补厚度，防止做成纸片人
3. 背面图（可选）→ 背甲结构
4. 贴图阶段：护目镜、能量核心、LED 各分独立材质通道
```

---

## 六、全身版特有的三个坑

**① 一定要说「靴底到天线完整可见」**
不写这句，AI 默认会从膝盖以上裁掉。

**② 一定要说「A-pose，双臂自然下垂」**
不写的话，AI 爱摆战斗姿势，剪影会乱，缩略图糊成一团。

**③ 一定要说「正方形 1:1 + 人物占 82% 高度」**
全身图在方形画布里很容易被画成细长一条，两侧大片空白。

---

## 七、和合约的对应关系

全身版的属性映射：

```
Gender     → 体型（女性更纤细、腿更长；男性更宽厚）
Skin       → 机体金属光泽（镜面铬 / 浅银 / 暖枪灰 / 深石墨）
Hair       → 头盖与肩甲金属色
Outfit     → 强调色护板 + 能量核心颜色
Accessory  → 头部配件（护目镜 / 耳机 / 皇冠 / 无）
```

5 个属性全部对应得上，不需要改合约。

---

## 八、交付期望

```
2D：1024×1024 或更高，正方形，纯深色背景，人物居中占 82% 高度
3D：GLB，单角色，脚在 Y=0，正面朝 +Z，附基础骨骼
```

拿到 2D 后我拆成 SVG 图层写进合约；3D 用官网首页的旋转展示。
