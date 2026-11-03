"""从海报裁出头部特写作为卡片头像"""
from PIL import Image
import os

SRC = "assets/posters"
OUT = "assets/thumbs"
os.makedirs(OUT, exist_ok=True)

# 海报 1024×1024 中，机甲头部大致在 (300,190) - (730,620)
BOX = (300, 170, 740, 610)

count = 0
for f in sorted(os.listdir(SRC)):
    if not f.endswith(".png"):
        continue
    im = Image.open(os.path.join(SRC, f)).convert("RGB")
    im = im.crop(BOX).resize((256, 256), Image.LANCZOS)
    im.save(os.path.join(OUT, f.replace(".png", ".webp")), "WEBP", quality=88, method=4)
    count += 1

total = sum(os.path.getsize(os.path.join(OUT, x)) for x in os.listdir(OUT))
print(f"生成 {count} 张头像，共 {total/1024:.0f} KB，平均 {total/count/1024:.0f} KB")
