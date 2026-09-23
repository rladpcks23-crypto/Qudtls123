#!/usr/bin/env python3
"""src/*.js 를 하나의 HTML로 묶는다.
  - neon-harbor.html : 더블클릭으로 바로 실행되는 단일 파일
  - dist/artifact.html : <html>/<body> 없이 본문만 (Artifact 게시용)
"""
import os
ROOT = os.path.dirname(os.path.abspath(__file__))
ORDER = ['core', 'world', 'vehicles', 'peds', 'police', 'missions', 'render', 'ui', 'main']
js = '\n'.join(open(os.path.join(ROOT, 'src', f + '.js'), encoding='utf-8').read() for f in ORDER)
shell = open(os.path.join(ROOT, 'src', 'shell.html'), encoding='utf-8').read()
body = shell.replace('<!-- SCRIPTS -->', '<script>\n' + js + '\n</script>')
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
open(os.path.join(ROOT, 'dist', 'artifact.html'), 'w', encoding='utf-8').write(body)
full = ('<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">\n'
        + body.replace('<canvas', '</head>\n<body>\n<canvas', 1) + '\n</body>\n</html>\n')
open(os.path.join(ROOT, 'neon-harbor.html'), 'w', encoding='utf-8').write(full)
print('built', len(full), 'bytes')
