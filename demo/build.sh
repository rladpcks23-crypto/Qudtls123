#!/usr/bin/env bash
# 홈라인 15초 시연 영상 재생성 (1920x1080, 남색 무대 + QR)
#   ./build.sh        -> 앱을 PC(가로) 화면으로  : homeline-demo-15s.mp4
#   ./build.sh phone  -> 앱을 폰 화면으로        : homeline-demo-15s-phone.mp4
# 준비: demo/site/ 에 홈라인 웹 버전 파일(index.html, 이미지, qrcode.min.js, logo-*.png)을 둔다.
#       'IBM Plex Sans KR', 'Gowun Batang' 글꼴이 시스템에 설치돼 있어야 한글이 제대로 나온다.
set -euo pipefail
cd "$(dirname "$0")"
python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1 & SRV=$!
trap 'kill $SRV' EXIT
sleep 1
if [ "${1:-}" = phone ]; then WIDE=0; OUT=homeline-demo-15s-phone.mp4; else WIDE=1; OUT=homeline-demo-15s.mp4; fi
WIDE=$WIDE node record.js
ffmpeg -v error -y -f concat -safe 0 -i raw/list.txt \
  -vf "fps=30,format=yuv420p" -c:v libx264 -preset slow -crf 18 -movflags +faststart \
  "$OUT"
echo "-> demo/$OUT"
