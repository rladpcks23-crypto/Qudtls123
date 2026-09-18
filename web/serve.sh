#!/usr/bin/env bash
# holo.html 은 카메라를 쓰기 때문에 file:// 로는 열리지 않는다.
# 브라우저는 https 또는 localhost 에서만 카메라를 내준다 — 그래서 이 서버가 필요하다.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-8000}"
echo
echo "  브라우저에서 아래 주소를 여세요:"
echo "    http://localhost:$PORT/holo.html      ← 손으로 조작 (카메라)"
echo "    http://localhost:$PORT/scroll-3d.html ← 스크롤 3D"
echo
echo "  멈추려면 Ctrl+C"
echo
exec python3 -m http.server "$PORT"
