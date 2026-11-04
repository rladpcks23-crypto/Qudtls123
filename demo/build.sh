#!/usr/bin/env bash
# 15초 시연 영상 재생성: Playwright로 앱을 조작하며 2x 캡처 → H.264 MP4
# 한글 자막은 'Noto Sans KR' 폰트가 설치돼 있어야 제대로 나온다.
set -euo pipefail
cd "$(dirname "$0")"
node record.js
ffmpeg -v error -y -f concat -safe 0 -i raw/list.txt \
  -vf "fps=30,format=yuv420p" -c:v libx264 -preset slow -crf 18 -movflags +faststart \
  redline-demo-15s.mp4
echo "-> demo/redline-demo-15s.mp4"
