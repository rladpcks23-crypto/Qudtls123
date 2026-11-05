"""Build the X-ray (glass) resource pack.

Usage: python3 make_pack.py <vanilla resource_pack/textures/blocks dir>
Replaces natural filler blocks with the vanilla glass texture (clear
centre, thin frame), so you see through rock while exposed faces still
show an outline.
"""
import json, os, sys, uuid
from PIL import Image, ImageDraw

SRC = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "pack")

FILLER = [
    # overworld stone & cave blocks
    "stone", "stone_granite", "stone_diorite", "stone_andesite", "tuff", "calcite",
    "dripstone_block", "smooth_basalt", "deepslate/deepslate", "deepslate/deepslate_top",
    # dirt-like / loose
    "dirt", "coarse_dirt", "gravel", "clay", "sand", "red_sand",
    "sandstone_normal", "sandstone_top", "sandstone_bottom",
    "red_sandstone_normal", "red_sandstone_top", "red_sandstone_bottom",
    "hardened_clay",
    # nether
    "netherrack", "basalt_side", "basalt_top", "blackstone", "blackstone_top",
    "soul_sand", "soul_soil",
    # end
    "end_stone",
]

manifest = os.path.join(OUT, "manifest.json")
ids = None
if os.path.exists(manifest):  # keep UUIDs stable across rebuilds
    m = json.load(open(manifest))
    ids = (m["header"]["uuid"], m["modules"][0]["uuid"])
os.makedirs(OUT, exist_ok=True)
h, mo = ids or (str(uuid.uuid4()), str(uuid.uuid4()))
json.dump({
    "format_version": 2,
    "header": {"name": "X-ray 유리 v1.2", "description": "돌·심층암·흙·네더랙 등 자연 블록을 유리처럼. 광석·동굴·상자가 비쳐 보임",
               "uuid": h, "version": [1, 2, 0], "min_engine_version": [1, 21, 0]},
    "modules": [{"type": "resources", "uuid": mo, "version": [1, 2, 0]}],
}, open(manifest, "w"), indent=2, ensure_ascii=False)

glass = Image.open(os.path.join(SRC, "glass.png")).convert("RGBA")
for name in FILLER:
    src = Image.open(os.path.join(SRC, name + ".png"))
    dst_png = os.path.join(OUT, "textures", "blocks", name + ".png")
    os.makedirs(os.path.dirname(dst_png), exist_ok=True)
    glass.resize(src.size, Image.NEAREST).save(dst_png)
    # Vibrant Visuals reads <name>.texture_set.json; point it at the clear texture only.
    if os.path.exists(os.path.join(SRC, name + ".texture_set.json")):
        json.dump({"format_version": "1.21.30",
                   "minecraft:texture_set": {"color": os.path.basename(name)}},
                  open(os.path.join(OUT, "textures", "blocks", name + ".texture_set.json"), "w"), indent=2)
    print(f"{name}: {src.size}")

# Icon: diamond ore seen through a glass frame.
ore = Image.open(os.path.join(SRC, "diamond_ore.png")).convert("RGBA").resize((128, 128), Image.NEAREST)
icon = Image.new("RGBA", (128, 128), (20, 24, 32, 255))
icon.alpha_composite(ore.resize((80, 80), Image.NEAREST), (24, 24))
d = ImageDraw.Draw(icon)
d.rectangle([4, 4, 123, 123], outline=(190, 230, 255, 255), width=6)
d.line([(20, 108), (52, 76)], fill=(220, 245, 255, 200), width=4)
icon.save(os.path.join(OUT, "pack_icon.png"))
