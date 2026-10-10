#!/usr/bin/env bash
# 홈라인 소개 영상 빌드
#   폰트 받기 → 효과음 큐 추출 → 사운드트랙 합성 → 60fps 프레임 렌더 → MP4 두 벌
#   dist/homeline_intro.mp4         : 앱으로 바로 보내기용 (30MB 아래)
#   dist/homeline_intro_master.mp4  : 고화질 원본 (2패스, GitHub 한도 100MB 아래)
# 필요: ../ 에서 npm install, python3(numpy, scipy), ffmpeg
# 시스템 크로뮴을 쓰려면 CHROME=/path/to/chromium 으로 지정
set -euo pipefail
cd "$(dirname "$0")"
PORT=${PORT:-8770}
FPS=${FPS:-60}
WORKERS=${WORKERS:-3}
export PORT

if [ ! -f fonts/gf/local.css ]; then
  mkdir -p fonts/gf/f
  curl -sSf -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" \
    "https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=block" \
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

python3 -m http.server "$PORT" >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV' EXIT
sleep 1

node ../cues.js sfx.json
python3 make_soundtrack.py sfx.json soundtrack.wav

rm -rf frames
node ../render.js frames "$FPS" "$WORKERS"
mkdir -p dist
X264="-c:v libx264 -preset slow -tune film -pix_fmt yuv420p -profile:v high -level 4.2"
ffmpeg -hide_banner -loglevel error -y -framerate "$FPS" -i frames/%05d.jpg -i soundtrack.wav -map 0:v -map 1:a \
  $X264 -crf 21 -c:a aac -b:a 192k -shortest -movflags +faststart dist/homeline_intro.mp4
ffmpeg -hide_banner -loglevel error -y -framerate "$FPS" -i frames/%05d.jpg $X264 -b:v 10900k -pass 1 -passlogfile frames/x264 -an -f null /dev/null
ffmpeg -hide_banner -loglevel error -y -framerate "$FPS" -i frames/%05d.jpg -i soundtrack.wav -map 0:v -map 1:a \
  $X264 -b:v 10900k -pass 2 -passlogfile frames/x264 -c:a aac -b:a 320k -shortest -movflags +faststart dist/homeline_intro_master.mp4
echo "→ dist/homeline_intro.mp4, dist/homeline_intro_master.mp4"
