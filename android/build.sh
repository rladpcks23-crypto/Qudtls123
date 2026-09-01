#!/usr/bin/env bash
# Rebuilds the Redline WebView APK with the current app/assets/index.html.
#
# Only assets/index.html changes, so instead of recompressing the whole
# archive (which would break Android's requirement that resources.arsc and
# the mipmap PNGs stay STORED/uncompressed for alignment), this patches the
# single entry into a copy of the pristine original.apk with `zip`, leaving
# every other entry byte-identical. No aapt/apktool needed -- just zip +
# jarsigner (both already need only a JDK).
set -euo pipefail
cd "$(dirname "$0")/.."

ORIGINAL_APK="android/original.apk"
OUT_UNSIGNED="android/dist/app-unsigned.apk"
OUT_SIGNED="android/dist/app-release.apk"
KEYSTORE="${KEYSTORE:-android/.release.keystore}"
KEY_ALIAS="${KEY_ALIAS:-release}"
KEY_STOREPASS="${KEY_STOREPASS:-changeit123}"

mkdir -p android/dist
cp "$ORIGINAL_APK" "$OUT_UNSIGNED"

# Drop the old signature (content changed, so it's invalid anyway).
zip -d "$OUT_UNSIGNED" "META-INF/*" >/dev/null

# Patch in the new payload, keeping every other entry (incl. resources.arsc
# and the icons, which must stay STORED) untouched.
( cd app && zip -X "$OLDPWD/$OUT_UNSIGNED" assets/index.html >/dev/null )

if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" -storepass "$KEY_STOREPASS" \
    -alias "$KEY_ALIAS" -keypass "$KEY_STOREPASS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Redline, OU=Personal, O=Redline, L=Seoul, ST=Seoul, C=KR" >/dev/null
fi

cp "$OUT_UNSIGNED" "$OUT_SIGNED"
jarsigner -verbose \
  -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore "$KEYSTORE" -storepass "$KEY_STOREPASS" \
  "$OUT_SIGNED" "$KEY_ALIAS" >/dev/null

echo "Built: $OUT_SIGNED"
jarsigner -verify "$OUT_SIGNED" | tail -1
