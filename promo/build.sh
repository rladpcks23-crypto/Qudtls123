#!/usr/bin/env bash
# 레드라인 소개 영상 빌드
#   폰트 받기 → 효과음 큐 추출 → 사운드트랙 합성 → 60fps 프레임 렌더 → MP4 인코딩
# 필요: node(+ npm install), python3(numpy, scipy), ffmpeg
# 시스템 크로뮴을 쓰려면 CHROME=/path/to/chromium 으로 지정
set -euo pipefail
cd "$(dirname "$0")"
PORT=${PORT:-8765}
FPS=${FPS:-60}
WORKERS=${WORKERS:-3}
export PORT

# 1) 폰트 (저장소에는 넣지 않고 받아서 쓴다)
if [ ! -f fonts/gf/local.css ]; then
  mkdir -p fonts/gf/f
  for w in Black ExtraBold Bold Medium; do
    curl -sSfLo "fonts/Pretendard-$w.woff2" "https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/woff2/Pretendard-$w.woff2"
  done
  curl -sSf -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" \
    "https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@600;700;800&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=block" \
    -o fonts/gf/gf.css
  python3 - <<'PY'
import re, subprocess, concurrent.futures as cf
css = open('fonts/gf/gf.css').read()
urls = sorted(set(re.findall(r'url\((https://fonts\.gstatic\.com/[^)]+)\)', css)))
def get(u):
    fn = u.split('/s/')[1].replace('/', '_')
    subprocess.run(['curl', '-sSf', '-o', 'fonts/gf/f/' + fn, u], check=True)
    return u, 'f/' + fn
with cf.ThreadPoolExecutor(16) as ex:
    for u, fn in ex.map(get, urls):
        css = css.replace(u, fn)
open('fonts/gf/local.css', 'w').write(css)
PY
fi

# 2) 로컬 서버 (폰트가 file:// 에서는 막히므로)
python3 -m http.server "$PORT" >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV' EXIT
sleep 1

# 3) 효과음 큐 → 사운드트랙
node cues.js sfx.json
python3 make_soundtrack.py sfx.json soundtrack.wav

# 4) 프레임 → MP4
rm -rf frames
node render.js frames "$FPS" "$WORKERS"
mkdir -p dist
ffmpeg -hide_banner -loglevel error -y -framerate "$FPS" -i frames/%05d.jpg -i soundtrack.wav \
  -map 0:v -map 1:a -c:v libx264 -preset slow -crf 21 -tune film -pix_fmt yuv420p -profile:v high -level 4.2 \
  -c:a aac -b:a 192k -shortest -movflags +faststart dist/redline_intro.mp4
# 고화질 원본 (GitHub 한도 100MB 아래)
ffmpeg -hide_banner -loglevel error -y -framerate "$FPS" -i frames/%05d.jpg -i soundtrack.wav \
  -map 0:v -map 1:a -c:v libx264 -preset slow -crf 15 -tune film -pix_fmt yuv420p -profile:v high -level 4.2 \
  -c:a aac -b:a 320k -shortest -movflags +faststart dist/redline_intro_master.mp4
echo "→ dist/redline_intro.mp4, dist/redline_intro_master.mp4"
