#!/bin/sh
# Zip the behavior pack into an .mcpack (tap it on the phone to import).
set -e
cd "$(dirname "$0")/pack"
rm -f ../../dist/enderman-5x-v2.mcpack
zip -r -X ../../dist/enderman-5x-v2.mcpack manifest.json spawn_rules
