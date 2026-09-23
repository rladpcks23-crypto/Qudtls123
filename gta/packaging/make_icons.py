#!/usr/bin/env python3
"""네온 하버 앱 아이콘: 어두운 밤하늘 바탕 + 네온 핑크 링 + 금색 수배 별."""
import math, os
from PIL import Image, ImageDraw, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'icons')
BG, PINK, GOLD = (10, 14, 23, 255), (255, 93, 143, 255), (242, 193, 78, 255)

def star(d, cx, cy, r, fill):
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.45
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    d.polygon(pts, fill=fill)

def art(size, with_bg, scale=1.0):
    S = size * 4
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    c = S / 2
    if with_bg:
        d = ImageDraw.Draw(img); d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.22, fill=BG)
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0)); g = ImageDraw.Draw(glow)
    R = S * 0.34 * scale
    g.ellipse([c - R, c - R, c + R, c + R], outline=PINK, width=int(S * 0.05 * scale))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.025))
    img = Image.alpha_composite(img, glow)
    d = ImageDraw.Draw(img)
    d.ellipse([c - R, c - R, c + R, c + R], outline=(255, 190, 210, 255), width=int(S * 0.022 * scale))
    star(d, c + S * 0.012, c + S * 0.02, S * 0.24 * scale, (60, 30, 10, 200))
    star(d, c, c, S * 0.24 * scale, GOLD)
    return img.resize((size, size), Image.LANCZOS)

os.makedirs(OUT, exist_ok=True)
art(1024, True).save(os.path.join(OUT, 'icon-1024.png'))
art(512, True).save(os.path.join(OUT, 'icon-512.png'))
art(256, True).save(os.path.join(OUT, 'icon.ico'), sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
for name, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    dd = os.path.join(OUT, 'android', f'mipmap-{name}-v4'); os.makedirs(dd, exist_ok=True)
    art(px, True).save(os.path.join(dd, 'ic_launcher.png'))
    art(px * 9 // 4, False, scale=0.62).save(os.path.join(dd, 'ic_launcher_fg.png'))  # 적응형 아이콘 전경(안전영역 66%)
print('icons ok')
