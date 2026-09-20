#!/usr/bin/env bash
# deck/morph-demo.pptx 를 만든다.
#
# 두 단계다. pptxgenjs 로 장을 그리고(build-morph-deck.js), 그 결과물의 XML 에
# 모핑 전환을 끼워 넣는다 — pptxgenjs 에는 화면 전환을 설정하는 기능이 없다.
set -euo pipefail
cd "$(dirname "$0")"

node build-morph-deck.js

python3 - <<'PY'
import zipfile

DECK = 'morph-demo.pptx'

# 파워포인트가 실제로 쓰는 모양 그대로다. 모핑을 모르는 옛 버전·다른 프로그램은
# mc:Fallback 의 페이드로 떨어진다 — 깨지지 않고 그냥 덜 화려해진다.
MORPH = (
    '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">'
    '<mc:Choice xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" Requires="p159">'
    '<p:transition xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"'
    ' spd="slow" p14:dur="1250"><p159:morph option="byObject"/></p:transition>'
    '</mc:Choice>'
    '<mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback>'
    '</mc:AlternateContent>'
)

zin = zipfile.ZipFile(DECK)
items = {n: zin.read(n) for n in zin.namelist()}
zin.close()

# 1장에는 넣지 않는다 — 전환은 "그 장으로 넘어올 때" 재생되므로 첫 장은 의미가 없다.
done = 0
for name in sorted(items):
    if not name.startswith('ppt/slides/slide') or not name.endswith('.xml'):
        continue
    if name == 'ppt/slides/slide1.xml':
        continue
    xml = items[name].decode('utf-8')
    if '<p:transition' in xml or 'p159:morph' in xml:
        continue
    if '</p:sld>' not in xml:
        raise SystemExit(f'{name}: </p:sld> 를 찾지 못했습니다')
    items[name] = xml.replace('</p:sld>', MORPH + '</p:sld>').encode('utf-8')
    done += 1

with zipfile.ZipFile(DECK, 'w', zipfile.ZIP_DEFLATED) as z:
    for n, d in items.items():
        z.writestr(n, d)

print(f'모핑 전환을 {done}개 장에 넣었습니다 → {DECK}')
PY
