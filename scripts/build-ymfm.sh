#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$ROOT/runtime/ymfm/versions.env"
BUILD="$ROOT/.cache/ymfm-prototype"
OUTPUT="$ROOT/src/vendor/ymfm-build"
export EM_CACHE="$ROOT/.cache/emscripten-$EMSCRIPTEN_VERSION"
mkdir -p "$BUILD" "$OUTPUT"
case "$(emcc --version | sed -n '1p')" in
  *" $EMSCRIPTEN_VERSION"*) ;;
  *) echo "Expected Emscripten $EMSCRIPTEN_VERSION" >&2; exit 1 ;;
esac
sha() { shasum -a 256 "$1" | awk '{print $1}'; }
ARCHIVE="$BUILD/source.tar.gz"
if [ ! -f "$ARCHIVE" ]; then
  curl --fail --location --silent --show-error \
    "https://codeload.github.com/aaronsgiles/ymfm/tar.gz/$YMFM_COMMIT" -o "$ARCHIVE"
fi
[ "$(sha "$ARCHIVE")" = "$YMFM_ARCHIVE_SHA256" ] || { echo 'Source checksum mismatch' >&2; exit 1; }
tar -xzf "$ARCHIVE" -C "$BUILD"
SOURCE="$BUILD/ymfm-$YMFM_COMMIT"
[ "$(sha "$SOURCE/LICENSE")" = "$YMFM_LICENSE_SHA256" ] || exit 1
[ "$(sha "$ROOT/runtime/ymfm/LICENSE")" = "$YMFM_LICENSE_SHA256" ] || exit 1
em++ -std=c++14 -O3 -DNDEBUG -I"$SOURCE/src" \
  "$ROOT/runtime/ymfm/wrapper.cpp" "$SOURCE/src/ymfm_opn.cpp" \
  "$SOURCE/src/ymfm_ssg.cpp" "$SOURCE/src/ymfm_adpcm.cpp" \
  --no-entry -s STANDALONE_WASM=1 -s FILESYSTEM=0 \
  -s INITIAL_MEMORY=2097152 -s STACK_SIZE=65536 -s ALLOW_MEMORY_GROWTH=0 \
  -s EXPORTED_FUNCTIONS='["_fm_init","_fm_write","_fm_buffer","_fm_render"]' \
  -o "$OUTPUT/ym2203.wasm"
cp "$ROOT/runtime/ymfm/LICENSE" "$OUTPUT/LICENSE.txt"
cp "$ROOT/runtime/ymfm/LICENSE" "$ROOT/public/ymfm-LICENSE.txt"
{ printf '%s  %s\n' "$(sha "$OUTPUT/ym2203.wasm")" 'src/vendor/ymfm-build/ym2203.wasm'; } > "$ROOT/runtime/ymfm/artifacts.sha256"
echo "Built pinned YM2203 FM + SSG core"
