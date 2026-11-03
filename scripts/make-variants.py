"""
按 SKIN × OUTFIT 生成 24 张换色贴图
  机身（色相 200–285°）：按 SKIN 重新着色
  强调色（色相 285–360° / <20°）：按 OUTFIT 改色相
"""
from PIL import Image
import colorsys
import os

SRC = "assets/tex/texture_pbr_20250901.webp"
OUT = "assets/tex/variants"
os.makedirs(OUT, exist_ok=True)

# SKIN：目标机身色（线性乘子）
SKIN = {
    "fair":  (0.96, 0.97, 1.00),
    "light": (0.88, 0.90, 0.95),
    "tan":   (0.86, 0.73, 0.58),
    "deep":  (0.46, 0.50, 0.57),
}

# OUTFIT：目标强调色（RGB 0-1）与目标色相
OUTFIT = {
    "violet": (0.545, 0.427, 1.000),
    "teal":   (0.118, 0.784, 0.706),
    "coral":  (1.000, 0.478, 0.478),
    "amber":  (1.000, 0.671, 0.180),
    "azure":  (0.310, 0.557, 0.969),
    "orchid": (0.753, 0.420, 1.000),
}

def hue_of(rgb):
    h, s, v = colorsys.rgb_to_hsv(*rgb)
    return h * 360, s, v

def recolor(im, skin_key, out_key):
    w, h = im.size
    px = im.load()
    tint = SKIN[skin_key]
    acc = OUTFIT[out_key]
    ah, as_, av = colorsys.rgb_to_hsv(*acc)
    acc_hue = ah * 360

    out = Image.new("RGB", (w, h))
    op = out.load()

    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            R, G, B = r / 255, g / 255, b / 255
            hh, s, v = colorsys.rgb_to_hsv(R, G, B)
            H = hh * 360

            # 深色部件（关节、内构）保持原样
            if v < 0.18:
                op[x, y] = (r, g, b)
                continue

            is_body = (200 <= H <= 288) and s < 0.60
            is_acc = (H >= 288 or H <= 20) and s >= 0.10 and v >= 0.22

            if is_acc:
                # 强调色：换色相，提升饱和，保留明度
                ns = min(0.92, max(0.42, s * 1.55))
                nr, ng, nb = colorsys.hsv_to_rgb(ah, ns, min(1.0, v * 1.02))
                op[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255))
            elif is_body:
                # 机身：保留明暗，乘目标色
                lum = 0.299 * R + 0.587 * G + 0.114 * B
                k = min(1.0, lum * 1.10)
                nr = min(1.0, k * tint[0])
                ng = min(1.0, k * tint[1])
                nb = min(1.0, k * tint[2])
                op[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255))
            else:
                op[x, y] = (r, g, b)
    return out

src = Image.open(SRC).convert("RGB")
print(f"源贴图 {src.size[0]}x{src.size[1]}")

count = 0
for sk in SKIN:
    for of in OUTFIT:
        im = recolor(src, sk, of)
        name = f"{sk}_{of}.webp"
        im.save(os.path.join(OUT, name), "WEBP", quality=88, method=4)
        count += 1
        print(f"  {name}")

print(f"\n生成 {count} 张，输出目录 {OUT}")
