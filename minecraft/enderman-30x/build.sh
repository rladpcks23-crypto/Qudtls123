#!/bin/sh
# Zip the behavior pack into an .mcpack (tap it on the phone to import).
set -e
cd "$(dirname "$0")/pack"
rm -f ../../dist/enderman-30x.mcpack
zip -r -X ../../dist/enderman-30x.mcpack manifest.json spawn_rules
