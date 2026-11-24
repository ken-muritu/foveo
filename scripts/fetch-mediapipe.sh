#!/usr/bin/env sh
# Download MediaPipe Tasks Vision (Apache-2.0) + the Face Landmarker model into
# src/vendor/mediapipe/ so Foveo runs fully offline afterwards.
set -eu
cd "$(dirname "$0")/.."
VER="1.2.3"
OUT="src/vendor/mediapipe"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT/wasm"
( cd "$TMP" && npm pack "@mediapipe/tasks-vision@$VER" >/dev/null && tar xzf "mediapipe-tasks-vision-$VER.tgz" )
cp "$TMP/package/vision_bundle.js" "$OUT/vision_bundle.js"
cp "$TMP/package/wasm/vision_wasm_internal.js" "$TMP/package/wasm/vision_wasm_internal.wasm" "$OUT/wasm/"
curl -fsSL "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" -o "$OUT/face_landmarker.task"
[ "$(wc -c < "$OUT/face_landmarker.task")" -gt 1000000 ] || { echo "model download looks wrong" >&2; exit 1; }
echo "MediaPipe $VER + face_landmarker.task saved to $OUT"
