#!/usr/bin/env bash
# 네온 하버 PC판 → Windows 휴대용 exe (설치 없이 실행). 리눅스에서도 wine 없이 빌드된다.
set -euo pipefail
cd "$(dirname "$0")"
python3 ../../build.py >/dev/null
[ -f ../icons/icon.ico ] || python3 ../make_icons.py
mkdir -p app
cp ../../build/neon-harbor-pc.html app/index.html
cp ../icons/icon.ico icon.ico; cp ../icons/icon-512.png icon.png
[ -d node_modules ] || npm install --no-audit --no-fund
npx electron-builder --win portable
mkdir -p ../../release && cp dist/NeonHarbor-PC.exe ../../release/
echo "Built: gta/release/NeonHarbor-PC.exe"
