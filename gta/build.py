#!/usr/bin/env python3
"""src/*.js 를 PC판 / 모바일판 두 개의 단일 HTML로 묶는다.

  build/neon-harbor-pc.html       키보드·마우스·게임패드, 고해상도, 교통량 많음
  build/neon-harbor-mobile.html   터치 조작 기본, 전체화면·가로, 진동, 가벼운 렌더링
  dist/artifact-pc.html           웹 게시용 본문(<html>/<body> 없음)
  dist/artifact-mobile.html

데스크톱(Windows exe)과 안드로이드(APK)는 각각 PC판, 모바일판 HTML을 감싼다.
"""
import os
ROOT = os.path.dirname(os.path.abspath(__file__))
ORDER = ['core', 'world', 'vehicles', 'peds', 'police', 'missions', 'jobs', 'npc', 'military', 'render', 'view3d', 'ui', 'economy', 'gangs', 'empire', 'finance', 'wardrobe', 'casino', 'events', 'main']
JS = '\n'.join(open(os.path.join(ROOT, 'src', f + '.js'), encoding='utf-8').read() for f in ORDER)
SHELL = open(os.path.join(ROOT, 'src', 'shell.html'), encoding='utf-8').read()
# Three.js (MIT) — 3D 시점용. 오프라인 APK/EXE에서도 돌도록 파일 안에 넣는다. 첫 줄의 폐기 경고는 뺀다.
_t = open(os.path.join(ROOT, 'vendor', 'three.min.js'), encoding='utf-8').read()
THREE = 'void 0,' + _t.split('\n', 1)[1] if _t.startswith('console.warn') else _t
TITLES = {'pc': '네온 하버 PC', 'mobile': '네온 하버 모바일'}

os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
# v2.8부터 PC판만 만든다. 모바일판이 필요하면: python3 build.py --mobile
import sys
PLATS = ['pc', 'mobile'] if '--mobile' in sys.argv else ['pc']
for plat, title in [(p, TITLES[p]) for p in PLATS]:
    body = SHELL.replace('<title>네온 하버</title>', f'<title>{title}</title>', 1)
    body = body.replace('<!-- SCRIPTS -->', '<script>\n' + THREE + '\n</script>\n' + f"<script>\nconst NH_PLATFORM = '{plat}';\n" + JS + '\n</script>')
    open(os.path.join(ROOT, 'dist', f'artifact-{plat}.html'), 'w', encoding='utf-8').write(body)
    vp = 'width=device-width, initial-scale=1, viewport-fit=cover'
    if plat == 'mobile':
        vp += ', maximum-scale=1, user-scalable=no'
    extra = '<meta name="theme-color" content="#0a0e17">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-capable" content="yes">\n' if plat == 'mobile' else ''
    full = ('<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n'
            f'<meta name="viewport" content="{vp}">\n' + extra
            + body.replace('<canvas', '</head>\n<body>\n<canvas', 1) + '\n</body>\n</html>\n')
    out = os.path.join(ROOT, 'build', f'neon-harbor-{plat}.html')
    open(out, 'w', encoding='utf-8').write(full)
    print('built', os.path.relpath(out, ROOT), len(full), 'bytes')
