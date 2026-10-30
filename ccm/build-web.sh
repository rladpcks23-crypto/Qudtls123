#!/usr/bin/env bash
# 인터넷 배포용 정적 페이지를 만듭니다: ccm/dist/index.html
#   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_KEY=sb_publishable_... ./build-web.sh
# SUPABASE_KEY 는 공개용(publishable/anon) 키입니다. service_role 키는 절대 넣지 마세요.
set -euo pipefail
cd "$(dirname "$0")"
: "${SUPABASE_URL:?SUPABASE_URL 이 필요해요}"
: "${SUPABASE_KEY:?SUPABASE_KEY 가 필요해요}"
mkdir -p dist
{
  printf '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
  printf '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  printf '<style>body{margin:0}[hidden]{display:none!important}img{max-width:100%%}</style>'
  printf '<script>window.CCM_SUPABASE={url:%s,key:%s};</script>' \
    "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$SUPABASE_URL")" \
    "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$SUPABASE_KEY")"
  printf '</head><body>'
  cat index.html
  printf '</body></html>\n'
} > dist/index.html
echo "dist/index.html 을 만들었어요"
