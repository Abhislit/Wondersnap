#!/usr/bin/env bash
# Downloads the MediaPipe Tasks Vision runtime and the hand landmark model.
# Run once after cloning:  ./setup.sh
#
# These are third-party binaries, ~42 MB, so they are not kept in git.

set -euo pipefail

DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/vendor/mediapipe"
VERSION="1.0.1"
TARBALL="mediapipe-tasks-vision-${VERSION}.tgz"

WASM_BASE="https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
WASM_FILES=(
  "vision_bundle.mjs"
  "vision_wasm_internal.js"
  "vision_wasm_internal.wasm"
  "vision_wasm_module_internal.js"
  "vision_wasm_module_internal.wasm"
  "vision_wasm_nosimd_internal.js"
  "vision_wasm_nosimd_internal.wasm"
)

if [ -f "${DEST}/hand_landmarker.task" ] && [ -f "${DEST}/vision_bundle.mjs" ]; then
  echo "MediaPipe runtime already present in ${DEST}"
  exit 0
fi

command -v npm >/dev/null || { echo "error: npm is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "error: curl is required" >&2; exit 1; }

mkdir -p "${DEST}"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

echo "==> Fetching @mediapipe/tasks-vision@${VERSION}"
cd "${TMP}"
npm pack "@mediapipe/tasks-vision@${VERSION}" --silent >/dev/null
tar xzf "${TARBALL}"

cp package/vision_bundle.mjs "${DEST}/"
for file in "${WASM_FILES[@]}"; do
  case "${file}" in
    vision_bundle.mjs) continue ;;
  esac
  echo "==> ${file}"
  cp "package/wasm/${file}" "${DEST}/"
done

echo "==> hand_landmarker.task"
curl -fsSL -o "${DEST}/hand_landmarker.task" "${WASM_BASE}"

echo
echo "Done. MediaPipe runtime is in ${DEST}"
echo "Start the app with:  python3 -m http.server 8000"
echo "Then open:          http://localhost:8000"
