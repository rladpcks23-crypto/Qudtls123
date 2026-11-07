"""Rough preview of the village banner (20x40 banner face, scaled up)."""
from PIL import Image, ImageDraw
W, H, S = 20, 40, 12
BLACK, GRAY, YELLOW = (29, 29, 33), (71, 79, 82), (254, 216, 61)
img = Image.new("RGB", (W, H), BLACK)                      # 1 black banner
px = img.load()
for y in range(H):                                          # 2 dark-grey bricks
    row = y // 4
    for x in range(W):
        if y % 4 == 3 or (x + (row % 2) * 4) % 8 == 7:
            px[x, y] = GRAY
d = ImageDraw.Draw(img)
d.line([(0, 0), (W - 1, H - 1)], YELLOW, width=3)          # 3 yellow saltire
d.line([(W - 1, 0), (0, H - 1)], YELLOW, width=3)
cx, cy = W // 2, H // 2                                     # 4 black lozenge
d.polygon([(cx, cy - 11), (cx + 7, cy), (cx, cy + 11), (cx - 7, cy)], BLACK)
d.ellipse([cx - 4, cy - 4, cx + 3, cy + 3], YELLOW)        # 5 yellow roundel
d.rectangle([0, 0, W - 1, H - 1], outline=BLACK, width=2)   # 6 black bordure
big = img.resize((W * S, H * S), Image.NEAREST)
out = Image.new("RGB", (W * S + 80, H * S + 120), (235, 235, 235))
od = ImageDraw.Draw(out)
od.rectangle([30, 20, W * S + 50, 34], fill=(110, 80, 50))   # pole bar
out.paste(big, (40, 34))
out.save("banner_preview.png")
