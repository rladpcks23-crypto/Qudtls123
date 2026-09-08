#!/usr/bin/env bash
# Regenerates web/tangbu-redline.html from app/assets/index.html: same app,
# reshaped from a standalone document into an Artifact-ready fragment
# (title + style + body content, no <!doctype>/<html>/<head>/<body> wrapper,
# since the Artifact host supplies its own).
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - <<'PY'
import re

src = open("app/assets/index.html", encoding="utf-8").read()

m = re.search(r"</head><body>", src)
head, body = src[:m.start()], src[m.end():]
body = re.sub(r"</body></html>\s*$", "", body)

title_m = re.search(r"<title>(.*?)</title>", body)
title_text = title_m.group(1)
body = (body[:title_m.start()] + body[title_m.end():]).lstrip("\n")

style_block = re.search(r"<style>.*?</style>", head, re.S).group(0)
cs_m = re.search(r'<meta name="color-scheme"[^>]*>', head)
colorscheme = cs_m.group(0) if cs_m else ""

out = f"<title>{title_text}</title>\n{colorscheme}\n{style_block}\n{body}"
open("web/tangbu-redline.html", "w", encoding="utf-8").write(out)
print("wrote web/tangbu-redline.html:", len(out), "bytes")
PY
