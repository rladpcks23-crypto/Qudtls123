#!/usr/bin/env bash
# Builds 탕부하나님 레드라인 as its own, independent Android app -- a
# different applicationId and launcher label from the original "레드라인"
# app, so it installs side by side instead of overwriting/updating it.
#
# Requires: apktool, aapt (or aapt2), zipalign, keytool (JDK), apksigner.
# On Debian/Ubuntu:  apt-get install -y apktool aapt zipalign
# apksigner isn't packaged by apt; android/tools/apksigner (+ .jar) is a
# vendored copy from the official AOSP build-tools distribution (Apache-2.0)
# so builds don't depend on re-downloading it.
#
# apksigner (not jarsigner) matters here: jarsigner only produces a v1/JAR
# signature. The original app is v1+v2+v3 signed, and some devices (seen:
# a v1-only rebuild failing to install with a bare "app not installed",
# no unknown-sources or Play Protect prompt involved) refuse to install
# v1-only APKs. apksigner adds v2/v3 alongside v1.
set -euo pipefail
cd "$(dirname "$0")/.."

APKSIGNER="$(command -v apksigner || true)"
if [ -z "$APKSIGNER" ] && [ -x "android/tools/apksigner" ]; then
  APKSIGNER="android/tools/apksigner"
fi
if [ -z "$APKSIGNER" ]; then
  echo "error: apksigner not found (checked PATH and android/tools/apksigner)" >&2
  exit 1
fi

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
# IMPORTANT: this keystore is committed to the repo on purpose. Android
# refuses to install an APK over an existing install of the same
# applicationId unless the signing certificate matches, so every rebuild
# MUST reuse the same key or updates will fail with an "app not installed"
# conflict. This is a throwaway self-signed key for a personal sideloaded
# app (never published to a store), so committing it is fine -- do NOT
# delete/regenerate it unless you intend to force everyone to uninstall
# the old copy first.
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

echo "== zipalign (must run BEFORE apksigner v2/v3 signing) =="
ALIGNED="$WORK/aligned.apk"
zipalign -f -p 4 "$UNSIGNED" "$ALIGNED"

echo "== sign (v1 + v2 + v3, via apksigner) =="
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" -storepass "$KEY_STOREPASS" \
    -alias "$KEY_ALIAS" -keypass "$KEY_STOREPASS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Tangbu Redline, OU=Personal, O=Tangbu Redline, L=Seoul, ST=Seoul, C=KR" >/dev/null
fi
cp "$ALIGNED" "$SIGNED"
"$APKSIGNER" sign \
  --ks "$KEYSTORE" --ks-pass "pass:$KEY_STOREPASS" --ks-key-alias "$KEY_ALIAS" \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  "$SIGNED"
cp "$SIGNED" "$OUT_APK"

echo "== verify =="
"$APKSIGNER" verify --verbose "$OUT_APK"
zipalign -c 4 "$OUT_APK" >/dev/null && echo "zipalign OK"

echo "Built: $OUT_APK  (package=$NEW_PACKAGE, label=$NEW_LABEL)"
