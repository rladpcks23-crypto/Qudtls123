#!/bin/sh
# Rebuild the textures (needs the vanilla blocks dir from Mojang/bedrock-samples),
# then zip into an .mcpack: ./build.sh /path/to/resource_pack/textures/blocks
set -e
cd "$(dirname "$0")"
[ -n "$1" ] && python3 make_pack.py "$1"
cd pack
rm -f ../../dist/ore-glow-v1.1.mcpack
zip -r -X ../../dist/ore-glow-v1.1.mcpack manifest.json pack_icon.png textures
