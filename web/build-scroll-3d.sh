#!/usr/bin/env bash
# Builds web/scroll-3d.html from web/src/scroll-3d.html by inlining three.js.
#
# Why inline: ES modules can't be fetched over file://, so a page that imports
# three from ./vendor/ shows nothing when you just double-click it. Inlining the
# library means the built file opens straight from the file system — which is
# what you want on a presentation laptop with no network. Loading an actual
# .glb still needs a local server; the page says so.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - <<'PY'
import re

lib = open("web/vendor/three.module.min.js", encoding="utf-8").read()
src = open("web/src/scroll-3d.html", encoding="utf-8").read()

# three ships one trailing `export{a as Scene, b as Mesh, ...}`. Inlined, those
# exported names aren't reachable from the page code, so rewrite that statement
# into a plain THREE object holding the same bindings.
m = re.search(r"export\s*\{([^{}]*)\}\s*;?\s*$", lib.rstrip())
if not m:
    raise SystemExit("three.js: trailing export{...} not found — did the build format change?")

entries = []
for part in m.group(1).split(","):
    part = part.strip()
    if not part:
        continue
    inner, _, public = part.partition(" as ")
    entries.append(f"{public.strip() or inner}:{inner.strip()}")

lib = lib[:m.start()] + "const THREE={" + ",".join(entries) + "};\n"

marker = "/*__THREE__*/"
if marker not in src:
    raise SystemExit(f"web/src/scroll-3d.html: {marker} marker missing")

banner = "/* three.js r169 — MIT © three.js authors. 아래 한 줄이 라이브러리 전체입니다. */\n"
out = src.replace(marker, banner + lib + "\n/* ---------- 여기부터 이 페이지 코드 ---------- */")
open("web/scroll-3d.html", "w", encoding="utf-8").write(out)
print(f"wrote web/scroll-3d.html: {len(out):,} bytes, {len(entries)} three.js exports inlined")
PY
