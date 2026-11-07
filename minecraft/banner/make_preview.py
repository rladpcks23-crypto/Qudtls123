"""Rough previews of the village banner (20x40 banner face, scaled up),
one per accent dye colour, side by side in banner_colors.png."""
from PIL import Image, ImageDraw
W, H, S = 20, 40, 12
BLACK, GRAY = (29, 29, 33), (71, 79, 82)
DYES = {"yellow": (254, 216, 61), "red": (176, 46, 38), "purple": (137, 50, 184), "light_blue": (58, 179, 218)}


def banner(YELLOW):
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
    return img.resize((W * S, H * S), Image.NEAREST)


panels = [banner(c) for c in DYES.values()]
out = Image.new("RGB", (len(panels) * (W * S + 40) + 40, H * S + 60), (235, 235, 235))
od = ImageDraw.Draw(out)
for i, p in enumerate(panels):
    x = 40 + i * (W * S + 40)
    od.rectangle([x - 10, 20, x + W * S + 10, 34], fill=(110, 80, 50))
    out.paste(p, (x, 34))
out.save("banner_colors.png")
