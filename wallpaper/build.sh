#!/usr/bin/env bash
# Builds 공부모드 배경화면 as a portable Windows .exe (no install needed).
#
# Requires node/npm. On Linux, electron-builder also wants wine (wine32 +
# wine64) to embed the icon into the .exe; without wine, run with
# NO_WINE=1 to skip that step (the app still works, the .exe just shows
# Electron's default icon in Explorer).
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund
fi

extra=()
if [ "${NO_WINE:-0}" = "1" ]; then
  extra+=(-c.win.signAndEditExecutable=false)
fi
npx electron-builder --win portable "${extra[@]}"

echo "Built: dist/공부모드배경화면.exe"
