#!/usr/bin/env bash
# Builds 탕부하나님 레드라인 as its own, independent Android app -- a
# different applicationId and launcher label from the original "레드라인"
# app, so it installs side by side instead of overwriting/updating it.
#
# Requires: apktool, aapt (or aapt2), zipalign, jarsigner/keytool (JDK).
# On Debian/Ubuntu:  apt-get install -y apktool aapt zipalign
set -euo pipefail
cd "$(dirname "$0")/.."

ORIGINAL_APK="android/original.apk"
NEW_PACKAGE="${NEW_PACKAGE:-kr.yechan.tangburedline}"
NEW_LABEL="${NEW_LABEL:-탕부하나님 레드라인}"
SRC_HTML="app/assets/index.html"

WORK="$(mktemp -d)"
DECODED="$WORK/decoded"
UNSIGNED="$WORK/unsigned.apk"
SIGNED="$WORK/signed.apk"

OUT_DIR="android/dist"
OUT_APK="$OUT_DIR/app-release.apk"
KEYSTORE="${KEYSTORE:-android/.release.keystore}"
KEY_ALIAS="${KEY_ALIAS:-tangbu}"
KEY_STOREPASS="${KEY_STOREPASS:-changeit123}"

mkdir -p "$OUT_DIR"
trap 'rm -rf "$WORK"' EXIT

echo "== decode original.apk =="
apktool d -f -o "$DECODED" "$ORIGINAL_APK" >/dev/null

echo "== rename package -> $NEW_PACKAGE, label -> $NEW_LABEL =="
sed -i "s/package=\"[^\"]*\"/package=\"$NEW_PACKAGE\"/" "$DECODED/AndroidManifest.xml"
# app_name is whatever string res/values/strings.xml currently maps android:label to.
python3 - "$DECODED/res/values/strings.xml" "$NEW_LABEL" <<'PY'
import re, sys
path, label = sys.argv[1], sys.argv[2]
xml = open(path, encoding="utf-8").read()
xml = re.sub(r'(<string name="app_name">)[^<]*(</string>)', rf'\g<1>{label}\g<2>', xml, count=1)
open(path, "w", encoding="utf-8").write(xml)
PY

echo "== patch payload =="
cp "$SRC_HTML" "$DECODED/assets/index.html"

echo "== patch app icon =="
for density in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  cp "app/icons/mipmap-${density}-v4/ic_launcher.png" "$DECODED/res/mipmap-${density}-v4/ic_launcher.png"
  cp "app/icons/mipmap-${density}-v4/ic_launcher_fg.png" "$DECODED/res/mipmap-${density}-v4/ic_launcher_fg.png"
done

echo "== rebuild =="
apktool b "$DECODED" -o "$UNSIGNED" >/dev/null

echo "== sign =="
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" -storepass "$KEY_STOREPASS" \
    -alias "$KEY_ALIAS" -keypass "$KEY_STOREPASS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Tangbu Redline, OU=Personal, O=Tangbu Redline, L=Seoul, ST=Seoul, C=KR" >/dev/null
fi
cp "$UNSIGNED" "$SIGNED"
jarsigner -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore "$KEYSTORE" -storepass "$KEY_STOREPASS" \
  "$SIGNED" "$KEY_ALIAS" >/dev/null

echo "== zipalign (must run after signing) =="
zipalign -f -p 4 "$SIGNED" "$OUT_APK"

echo "== verify =="
jarsigner -verify "$OUT_APK" | tail -1
zipalign -c 4 "$OUT_APK" >/dev/null && echo "zipalign OK"

echo "Built: $OUT_APK  (package=$NEW_PACKAGE, label=$NEW_LABEL)"
