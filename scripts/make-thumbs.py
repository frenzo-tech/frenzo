"""从海报生成 256px 缩略图"""
from PIL import Image
import os

SRC = "assets/posters"
OUT = "assets/thumbs"
os.makedirs(OUT, exist_ok=True)

count = 0
for f in sorted(os.listdir(SRC)):
    if not f.endswith(".png"):
        continue
    im = Image.open(os.path.join(SRC, f)).convert("RGB")
    im = im.resize((256, 256), Image.LANCZOS)
    im.save(os.path.join(OUT, f.replace(".png", ".webp")), "WEBP", quality=86, method=4)
    count += 1

total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print(f"生成 {count} 张缩略图，共 {total/1024:.0f} KB，平均 {total/count/1024:.0f} KB")
