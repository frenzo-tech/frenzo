"""
分析 baseColor 贴图的色相分布，找出可以分离的色区
"""
from PIL import Image
import colorsys
from collections import Counter

src = "assets/tex/texture_pbr_20250901.webp"
im = Image.open(src).convert("RGB")
w, h = im.size
print(f"尺寸 {w}x{h}")

px = im.load()
hue_bins = Counter()
sat_bins = Counter()
val_bins = Counter()
pink = 0
silver = 0
dark = 0
total = 0

for y in range(0, h, 2):
    for x in range(0, w, 2):
        r, g, b = px[x, y]
        hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        total += 1
        hue_bins[int(hh * 36)] += 1
        sat_bins[int(s * 20)] += 1
        val_bins[int(v * 20)] += 1

        if s > 0.12 and v > 0.25 and (hh > 0.88 or hh < 0.04):
            pink += 1
        if s < 0.14 and v > 0.45:
            silver += 1
        if v < 0.22:
            dark += 1

print(f"采样 {total} 像素")
print(f"  粉色区（色相 >316° 或 <14°）{pink:6d}  {pink/total*100:5.1f}%")
print(f"  银白区（低饱和高亮度）     {silver:6d}  {silver/total*100:5.1f}%")
print(f"  深色区（亮度 <22%）        {dark:6d}  {dark/total*100:5.1f}%")

print("\n色相分布（每格 10°）：")
for i in range(36):
    if hue_bins[i] == 0:
        continue
    pct = hue_bins[i] / total * 100
    if pct < 0.5:
        continue
    bar = "█" * int(pct / 2)
    print(f"  {i*10:3d}°  {pct:5.1f}%  {bar}")

print("\n饱和度分布：")
for i in range(20):
    if sat_bins[i] == 0:
        continue
    pct = sat_bins[i] / total * 100
    if pct < 2:
        continue
    print(f"  {i*5:3d}%  {pct:5.1f}%")
