"""Build the ore highlight + glow resource pack.

Usage: python3 make_pack.py <vanilla resource_pack/textures/blocks dir> [preview.png]

Keeps the vanilla ore textures and only adds a 1-px frame in a colour per
ore. With Vibrant Visuals on, a MERS texture makes the frame emissive so it
glows in the dark. (RECOLOR = True restores the earlier vivid-speck style.)
"""
import colorsys, json, os, sys, uuid
import numpy as np
from PIL import Image, ImageDraw

SRC = sys.argv[1]
PREVIEW = sys.argv[2] if len(sys.argv) > 2 else None
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "pack")
BLK = os.path.join(OUT, "textures", "blocks")
RECOLOR = False

# name -> (vivid colour, outline colour, base kind)
ORES = {
    "coal_ore": ((15, 15, 15), None, "stone"),
    "iron_ore": ((255, 150, 70), (0, 0, 0), "stone"),
    "copper_ore": ((0, 230, 180), (0, 0, 0), "stone"),
    "gold_ore": ((255, 230, 0), (0, 0, 0), "stone"),
    "redstone_ore": ((255, 20, 20), (0, 0, 0), "stone"),
    "lapis_ore": ((50, 90, 255), (0, 0, 0), "stone"),
    "diamond_ore": ((0, 240, 255), (0, 0, 0), "stone"),
    "emerald_ore": ((0, 255, 60), (0, 0, 0), "stone"),
    "nether_gold_ore": ((255, 230, 0), (0, 0, 0), "nether"),
    "quartz_ore": ((255, 255, 255), (0, 0, 0), "nether"),
    "ancient_debris_side": ((255, 50, 255), (0, 0, 0), "debris"),
    "ancient_debris_top": ((255, 50, 255), (0, 0, 0), "debris"),
}
for o in ["coal_ore", "iron_ore", "copper_ore", "gold_ore", "redstone_ore", "lapis_ore", "diamond_ore", "emerald_ore"]:
    c, ol, _ = ORES[o]
    ORES["deepslate/deepslate_" + o] = (c, ol, "deepslate")


def hsv(px):
    r, g, b = (px[..., i] / 255.0 for i in range(3))
    out = np.zeros(px.shape[:2] + (3,))
    for y in range(px.shape[0]):
        for x in range(px.shape[1]):
            out[y, x] = colorsys.rgb_to_hsv(r[y, x], g[y, x], b[y, x])
    return out


def ore_mask(name, px, kind):
    h, s, v = (hsv(px)[..., i] for i in range(3))
    if kind == "debris":  # no host rock: highlight the lighter streaks
        return v > np.percentile(v, 60)
    if "coal_ore" in name:  # coal is darker than its host rock
        return v < (0.22 if kind == "stone" else 0.13)
    if kind == "nether":  # netherrack is saturated red
        if "quartz" in name:
            return (s < 0.35) & (v > 0.55)
        return (h > 0.08) & (h < 0.2) & (s > 0.4)
    return s > (0.18 if kind == "stone" else 0.15)  # grey host rock


def outline(mask):
    m = np.pad(mask, 1)
    near = m[:-2, 1:-1] | m[2:, 1:-1] | m[1:-1, :-2] | m[1:-1, 2:]
    return near & ~mask


manifest = os.path.join(OUT, "manifest.json")
ids = None
if os.path.exists(manifest):
    m = json.load(open(manifest))
    ids = (m["header"]["uuid"], m["modules"][0]["uuid"])
os.makedirs(BLK, exist_ok=True)
h, mo = ids or (str(uuid.uuid4()), str(uuid.uuid4()))
json.dump({
    "format_version": 2,
    "header": {"name": "광석 테두리 v1.1", "description": "원래 광석 모양 그대로 + 광석별 색 테두리. 선명한 비주얼을 켜면 테두리가 빛남",
               "uuid": h, "version": [1, 1, 0], "min_engine_version": [1, 21, 0]},
    "modules": [{"type": "resources", "uuid": mo, "version": [1, 1, 0]}],
}, open(manifest, "w"), indent=2, ensure_ascii=False)

previews = []
for name, (col, ol, kind) in ORES.items():
    src = np.array(Image.open(os.path.join(SRC, name + ".png")).convert("RGBA")).astype(float)
    mask = ore_mask(name, src, kind)
    edge = outline(mask)
    out = src.copy()
    lum = (0.3 * src[..., 0] + 0.59 * src[..., 1] + 0.11 * src[..., 2]) / 255.0
    shade = 0.65 + 0.35 * lum
    for i in range(3 if RECOLOR else 0):
        out[..., i] = np.where(mask, np.clip(col[i] * shade, 0, 255), out[..., i])
        if ol is not None and RECOLOR:
            out[..., i] = np.where(edge, ol[i], out[..., i])
    frame = np.zeros(mask.shape, bool)
    frame[0, :] = frame[-1, :] = frame[:, 0] = frame[:, -1] = True
    for i in range(3):
        out[..., i] = np.where(frame, 255 if "coal" in name else col[i], out[..., i])
    out[..., 3] = 255
    img = Image.fromarray(out.astype(np.uint8), "RGBA")
    dst = os.path.join(BLK, name + ".png")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    img.save(dst)

    # MERS: R metalness, G emissive, B roughness, A subsurface
    glow = (mask | frame) if RECOLOR else frame
    mers = np.zeros(src.shape, np.uint8)
    mers[..., 1] = np.where(glow, 255, 0)
    mers[..., 2] = 230
    Image.fromarray(mers, "RGBA").save(os.path.join(BLK, name + "_mers.tga"))
    base = os.path.basename(name)
    json.dump({"format_version": "1.21.30", "minecraft:texture_set": {
        "color": base, "metalness_emissive_roughness_subsurface": base + "_mers"}},
        open(os.path.join(BLK, name + ".texture_set.json"), "w"), indent=2)
    previews.append((name, Image.open(os.path.join(SRC, name + ".png")).convert("RGBA"), img))
    print(f"{name}: {int(mask.sum())} ore px")

# Icon
icon = previews[[n for n, *_ in previews].index("diamond_ore")][2].resize((128, 128), Image.NEAREST)
icon.save(os.path.join(OUT, "pack_icon.png"))

if PREVIEW:  # before/after sheet for checking the masks
    S = 8
    sheet = Image.new("RGBA", (len(previews) * (16 * S + 8), 2 * 16 * S + 8), (40, 40, 40, 255))
    for i, (_, a, b) in enumerate(previews):
        sheet.paste(a.resize((16 * S, 16 * S), Image.NEAREST), (i * (16 * S + 8), 0))
        sheet.paste(b.resize((16 * S, 16 * S), Image.NEAREST), (i * (16 * S + 8), 16 * S + 8))
    sheet.save(PREVIEW)
