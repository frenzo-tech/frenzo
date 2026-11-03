# FRENZO NFT · 机甲头像生成提示词

设计基准：`nft-designs4.html`（第三轮定稿）
用途：① 给 Grok 生成 2D 参考图　② 再喂给 3D 模型工具

---

## 一、主提示词（给 Grok / Midjourney / Flux）

```
A futuristic robot avatar bust for an NFT profile picture collection, front view, centered.

SUBJECT
Angular mecha helmet head on armored shoulders. The skull is a hard-edged geometric shell:
flat top, straight vertical sides, jaw tapering inward to a narrow chin. Not round, not egg-shaped —
industrial and machined, like a combat drone's faceplate.

DETAILS
· Wide horizontal visor band across the eye area, softly rounded ends, filled with a
  luminous purple-to-white-to-cyan gradient. Inside the visor: thin vertical scanline slots.
  Two small white specular glints on the visor's upper-left edge.
· Separate dark chin plate below the visor with four small rectangular vent slots, each
  glowing in the accent color.
· Two side ear units: vertical rounded rectangles attached to the helmet sides, each with
  a small glowing accent LED.
· One thin antenna rising from the upper right of the skull, tipped with a glowing orb
  and a soft halo.
· Panel seams and beveled edge highlights running along the helmet's outer rim.

MATERIAL
Brushed titanium and gunmetal, soft anisotropic reflections. Multi-stop metal gradient:
near-white highlight top-left, mid silver body, deep graphite shadow bottom-right.
Satin, not mirror-chrome. Subtle surface wear.

ARMOR
Rounded shoulder plates in a saturated accent color fading to near-black at the bottom,
with a small dark chest plate and two thin seam lines.

LIGHTING
Cinematic three-quarter key light from the upper left, cool cyan rim light along the right
edge, soft ambient fill. Slight bloom on the visor and LEDs.

BACKGROUND
Dark deep-navy to near-black radial gradient, a very faint circular ring outline behind
the head, subtle horizontal grid lines at 8% opacity.

STYLE
Clean modern vector-illustration-meets-3D-render, semi-flat shading with soft gradients,
crisp geometry, high contrast, premium collectible feel. No photoreal skin, no cartoon
googly eyes, no human face.

FRAMING
Square 1:1, head and shoulders filling the frame, centered, small margin at top.
No text, no logo, no watermark, no nameplate.
```

**参数建议**

```
--ar 1:1 --style raw --q 2
Midjourney 可加: --sref（如果先出一张满意的再锁定风格）
```

---

## 二、中文版（如果 Grok 中文更顺）

```
赛博机甲风格的头像半身像，正面视角，居中构图。

主体：棱角分明的机械头盔，平顶、两侧竖直、下颌向内收窄成窄下巴，
不是圆球也不是鸡蛋形，要像战斗机甲的舱盖。

细节：
· 横跨眼部的宽护目镜带，两端圆角，内部是紫→白→青的发光渐变，
  护目镜里有细密竖向扫描槽，左上角两道白色高光。
· 护目镜下方深色下巴护板，开四个小矩形散热槽，槽内发强调色光。
· 两侧耳部为竖向圆角矩形单元，各带一颗发光指示灯。
· 右上方一根细天线，顶端小球发光并带柔光晕。
· 头盔外沿有分模线和倒角高光。

材质：拉丝钛金属与枪灰，柔和各向异性反射。多段金属渐变——
左上接近白色的高光、中间银灰主体、右下深石墨阴影。哑光而非镜面，表面有轻微磨损。

装甲：圆润肩甲，饱和强调色向底部渐变到近黑，胸口一小块深色护板，两道细缝线。

光照：左上方三点式主光，右缘冷青色轮廓光，柔和环境补光，
护目镜与指示灯带轻微辉光。

背景：深海军蓝到近黑的径向渐变，头部后方一圈极淡的圆形轮廓线，
8% 透明度的细横线网格。

风格：现代矢量插画结合 3D 渲染，半平面着色加柔和渐变，几何利落，高对比，
高级收藏品质感。不要真实皮肤、不要卡通大眼、不要人脸。

构图：正方形 1:1，头肩填满画面，居中，顶部留少量余白。
不要文字、不要 logo、不要水印、不要名牌。
```

---

## 三、负面提示词

```
photorealistic human face, skin texture, cartoon eyes, googly eyes, anime girl,
cute chibi, egg-shaped head, round helmet, soft blob shape, gradient mesh noise,
text, letters, watermark, signature, logo, nameplate, cluttered background,
multiple heads, side view, 3/4 body, full body, extra limbs, low contrast,
washed out, oversaturated neon, cyberpunk city, wires hanging, weapons
```

---

## 四、五个属性的替换词

生成完主图后，用下面这些词替换对应部分，做出变体：

| 属性 | 取值 | 替换词 |
|---|---|---|
| **Outfit（强调色）** | Violet | `violet-purple accent` |
| | Teal | `teal-green accent` |
| | Coral | `warm coral-red accent` |
| | Amber | `amber-orange accent` |
| | Azure | `azure-blue accent` |
| | Orchid | `orchid-magenta accent` |
| **Hair（头盖金属色）** | Black | `black ceramic top plate` |
| | Brown | `bronze top plate` |
| | Gold | `gold-plated top plate` |
| | Rose | `rose-gold top plate` |
| | Blue | `cobalt top plate` |
| | Silver | `brushed silver top plate` |
| **Skin（面容光泽）** | Fair | `bright polished chrome face` |
| | Light | `light silver face` |
| | Tan | `warm gunmetal face` |
| | Deep | `dark graphite face` |
| **Gender（头形差异）** | Female | `narrower helmet, taller crown, slimmer jaw` |
| | Male | `wider helmet, heavier brow ridge, squared jaw` |
| **Accessory** | Visor | 默认（就是那条护目镜） |
| | Headset | `add over-ear headphone units with thick padded ear cups` |
| | Crown | `add a small angular gold crown floating above the helmet` |
| | None | `remove the antenna, keep the visor plain` |

---

## 五、给 3D 生成用的提示词

把上面选定的那张 2D 图喂给 **Meshy / Tripo / Rodin / Hitem3D**，配这段：

```
A single stylized robot head with armored shoulders, standing bust only, no body below chest.

CLEAN SINGLE OBJECT
Centered, isolated on a plain neutral mid-grey background, no scenery, no floor shadow,
no other objects.

GEOMETRY
Hard-surface low-poly-friendly shell: flat-topped helmet, straight sides, tapered jaw,
separate chin vent plate, two side ear cylinders, one thin antenna. Clean quad topology,
beveled edges, no messy boolean intersections.

MATERIALS (PBR)
· Body: brushed titanium, metallic 0.95, roughness 0.35, anisotropic highlights
· Visor: emissive gradient purple→white→cyan, emission strength 2.5, plus clearcoat
· Accent panels and vents: saturated colored plastic, metallic 0.1, roughness 0.4
· Ear LEDs and antenna tip: emissive accent color, strength 4.0

LIGHTING FOR RENDER
Three-point studio setup: key light upper-left, cool rim light right, soft fill.
Dark background for the final beauty render.

POSE AND FRAMING
Front-facing orthographic reference first (for symmetry), then a three-quarter beauty shot.
Head occupies 65% of frame height.

OUTPUT
Game-ready mesh, symmetric, no baked text, no watermark.
```

**3D 工具的操作顺序**

```
1. 先用正面正交图（orthographic front view）生成基础网格，保证左右对称
2. 再补侧面图（side view）让 AI 理解厚度
3. 贴图阶段把护目镜单独分一个材质通道，方便做发光
4. 导出 GLB，我们后面要用它反推 SVG 的分层结构
```

---

## 六、两个提醒

**① 生成图不要带文字**
名牌是我们自己在 SVG 里拼的（`echo.ai` + `MINER #7`），图里带文字会重复。

**② 一定要出「正面 + 侧面」两张**
只给正面，3D 工具会瞎猜厚度，做出来像个饼干。侧视图能显著提升成品率。

---

## 七、最终交付期望

```
2D：正方形 1024×1024 以上，主体居中，纯深色背景
3D：GLB 或 OBJ，单个物体，正面朝向 +Z 轴
```

拿到之后我把 2D 的结构拆成 SVG 图层（头盔壳 / 面甲 / 护目镜 / 散热槽 / 侧耳 / 天线 / 肩甲），
写进合约。3D 版用于官网和 OpenSea 的动效展示。
