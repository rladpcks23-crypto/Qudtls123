#!/usr/bin/env bash
# 네온 하버 PC판 → Windows 설치 파일(NeonHarbor-Setup.exe, 바탕화면·시작 메뉴 바로가기) + 휴대용 exe. 리눅스에서도 빌드된다.
set -euo pipefail
cd "$(dirname "$0")"
python3 ../../build.py >/dev/null
[ -f ../icons/icon.ico ] || python3 ../make_icons.py
mkdir -p app
cp ../../build/neon-harbor-pc.html app/index.html
cp ../icons/icon.ico icon.ico; cp ../icons/icon-512.png icon.png
[ -d node_modules ] || npm install --no-audit --no-fund
npx electron-builder --win dir portable
# 설치 파일은 wine 없이 되도록 리눅스용 makensis로 직접 만든다 (apt-get install nsis)
command -v makensis >/dev/null || apt-get install -y nsis >/dev/null
makensis -V2 -DVERSION="$(node -p "require('./package.json').version")" installer.nsi
mkdir -p ../../release && cp dist/NeonHarbor-PC.exe dist/NeonHarbor-Setup.exe ../../release/
echo "Built: gta/release/NeonHarbor-PC.exe, gta/release/NeonHarbor-Setup.exe"
