#!/usr/bin/env bash
# Builds the Windows desktop version of 탕부하나님 레드라인 as a portable
# .exe (no installation needed) via Electron + electron-builder.
#
# Requires: node/npm, and (only on Linux hosts) wine32 + wine64 -- Chromium's
# rcedit step is a 32-bit tool even for an x64 target, so both are needed to
# embed the icon/version info via Wine. On Debian/Ubuntu:
#   dpkg --add-architecture i386 && apt-get update
#   apt-get install -y wine32:i386 wine64
set -euo pipefail
cd "$(dirname "$0")"

echo "== sync payload from app/assets/index.html =="
mkdir -p app
cp ../app/assets/index.html app/index.html

echo "== install deps (first run only) =="
if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund
fi

echo "== build portable .exe =="
npx electron-builder --win portable

echo "Built: dist/탕부하나님레드라인.exe"
