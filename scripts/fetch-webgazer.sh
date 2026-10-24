#!/usr/bin/env sh
# Download WebGazer.js 2.0.1 into src/vendor/ and verify it byte for byte.
# WebGazer is GPLv3 (LGPLv3 for companies valued under $1M) and is not
# redistributed in this repository; this script fetches it from its authors.
set -eu
cd "$(dirname "$0")/.."
URL="https://raw.githubusercontent.com/brownhci/WebGazer/webgazer2.0.1/www/search/webgazer.js"
SHA256="d05db7bb5befc9de96bea89a3f8a09b45ea9fa4742b657e67f8c6e4db1107736"
OUT="src/vendor/webgazer.js"
curl -fsSL "$URL" -o "$OUT.tmp"
if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$OUT.tmp" | cut -d' ' -f1)
else got=$(shasum -a 256 "$OUT.tmp" | cut -d' ' -f1); fi
[ "$got" = "$SHA256" ] || { rm -f "$OUT.tmp"; echo "checksum mismatch: got $got" >&2; exit 1; }
mv "$OUT.tmp" "$OUT"
echo "WebGazer 2.0.1 saved to $OUT (sha256 verified)"
