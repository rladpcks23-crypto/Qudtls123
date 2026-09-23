#!/usr/bin/env bash
# 네온 하버 모바일판 → Android APK (가로 전체화면 WebView 앱)
#
# 저장소의 android/original.apk(WebView 한 장짜리 셸)를 풀어서
#  - 패키지명 kr.yechan.neonharbor, 앱 이름 "네온 하버"로 바꾸고 (기존 앱과 따로 설치됨)
#  - 가로 고정(sensorLandscape) + 상태표시줄 없는 전체화면 테마
#  - 인터넷 권한(웹 폰트용, 없으면 기본 한글 폰트로 대체)
#  - assets/index.html = build/neon-harbor-mobile.html
# 을 넣은 뒤 다시 묶고 zipalign → apksigner(v1+v2+v3)로 서명한다.
# 필요: apktool, zipalign, keytool(JDK), apksigner(android/tools에 동봉)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GTA="$(dirname "$HERE")"; REPO="$(dirname "$GTA")"
cd "$REPO"

python3 "$GTA/build.py" >/dev/null
[ -f "$HERE/icons/android/mipmap-mdpi-v4/ic_launcher.png" ] || python3 "$HERE/make_icons.py"

APKSIGNER="$(command -v apksigner || echo android/tools/apksigner)"
# 서명 키는 일부러 저장소에 커밋한다: 같은 키로 서명해야 새 버전이 기존 설치 위에 업데이트된다.
# (스토어에 올리지 않는 개인용 사이드로드 앱이라 공개 키스토어로 충분하다. 지우거나 새로 만들지 말 것.)
KEYSTORE="${KEYSTORE:-$HERE/neonharbor.keystore}"; KEY_ALIAS="${KEY_ALIAS:-neonharbor}"; KEY_STOREPASS="${KEY_STOREPASS:-neonharbor123}"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KEY_STOREPASS" -alias "$KEY_ALIAS" -keypass "$KEY_STOREPASS" \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Neon Harbor, OU=Personal, O=Neon Harbor, L=Seoul, ST=Seoul, C=KR" >/dev/null 2>&1
fi
PKG="kr.yechan.neonharbor"; LABEL="네온 하버"
OUT="$GTA/release/NeonHarbor-mobile.apk"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
D="$WORK/decoded"

echo "== decode =="
apktool d -f -o "$D" android/original.apk >/dev/null
ORIG_PKG="$(sed -n 's/.*package="\([^"]*\)".*/\1/p' "$D/AndroidManifest.xml" | head -1)"

echo "== manifest: $PKG, 가로 고정, 인터넷 권한 =="
python3 - "$D" "$PKG" "$ORIG_PKG" "$LABEL" <<'PY'
import re, sys
d, pkg, orig, label = sys.argv[1:5]
m = open(f"{d}/AndroidManifest.xml", encoding="utf-8").read()
m = re.sub(r'package="[^"]*"', f'package="{pkg}"', m, count=1)
# ".MainActivity" 같은 축약 이름은 새 패키지 기준으로 풀리므로, dex 안의 실제 클래스 위치로 고정한다
m = re.sub(r'android:name="\.([A-Za-z][A-Za-z0-9_]*)"', rf'android:name="{orig}.\1"', m)
m = m.replace('<activity ', '<activity android:screenOrientation="sensorLandscape" ', 1)
if 'android.permission.INTERNET' not in m:
    m = m.replace('<application ', '<uses-permission android:name="android.permission.INTERNET"/>\n    <application ', 1)
open(f"{d}/AndroidManifest.xml", "w", encoding="utf-8").write(m)
s = open(f"{d}/res/values/strings.xml", encoding="utf-8").read()
s = re.sub(r'(<string name="app_name">)[^<]*(</string>)', rf'\g<1>{label}\g<2>', s, count=1)
open(f"{d}/res/values/strings.xml", "w", encoding="utf-8").write(s)
c = open(f"{d}/res/values/colors.xml", encoding="utf-8").read()
c = re.sub(r'(<color name="ground">)[^<]*', r'\g<1>#ff0a0e17', c)
open(f"{d}/res/values/colors.xml", "w", encoding="utf-8").write(c)
st = open(f"{d}/res/values/styles.xml", encoding="utf-8").read()
st = st.replace('@android:style/Theme.DeviceDefault.NoActionBar"', '@android:style/Theme.DeviceDefault.NoActionBar.Fullscreen"')
open(f"{d}/res/values/styles.xml", "w", encoding="utf-8").write(st)
y = open(f"{d}/apktool.yml", encoding="utf-8").read()
y = re.sub(r"versionCode: '\d+'", "versionCode: '8'", y); y = re.sub(r"versionName: '[^']*'", "versionName: '1.7'", y)
open(f"{d}/apktool.yml", "w", encoding="utf-8").write(y)
PY

echo "== payload + icons =="
cp "$GTA/build/neon-harbor-mobile.html" "$D/assets/index.html"
for dens in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  cp "$HERE/icons/android/mipmap-$dens-v4/ic_launcher.png" "$HERE/icons/android/mipmap-$dens-v4/ic_launcher_fg.png" "$D/res/mipmap-$dens-v4/"
done

echo "== build / align / sign =="
apktool b "$D" -o "$WORK/unsigned.apk" >/dev/null
zipalign -f -p 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"
mkdir -p "$(dirname "$OUT")"; cp "$WORK/aligned.apk" "$OUT"
"$APKSIGNER" sign --ks "$KEYSTORE" --ks-pass "pass:$KEY_STOREPASS" --ks-key-alias "$KEY_ALIAS" \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true "$OUT"
rm -f "$OUT.idsig"; "$APKSIGNER" verify "$OUT" && zipalign -c 4 "$OUT" && echo "Built: $OUT"
