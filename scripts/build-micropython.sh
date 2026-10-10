#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
CONFIGURATION_DIR="$REPOSITORY_ROOT/runtime/micropython"

# shellcheck disable=SC1091
. "$CONFIGURATION_DIR/versions.env"

BUILD_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/micropython-web-lab-build.XXXXXX")
SOURCE_ARCHIVE="$BUILD_ROOT/micropython-$MICROPYTHON_VERSION.tar.gz"
SOURCE_DIR="$BUILD_ROOT/micropython-$MICROPYTHON_VERSION"
BUILD_DIR="$BUILD_ROOT/build-$WEB_LAB_BUILD_VARIANT"
OUTPUT_DIR="$REPOSITORY_ROOT/src/vendor/micropython-build"
EM_CACHE=${EM_CACHE:-"$REPOSITORY_ROOT/.cache/emscripten-$EMSCRIPTEN_VERSION"}
export EM_CACHE

cleanup() {
  rm -rf "$BUILD_ROOT"
}
trap cleanup EXIT HUP INT TERM

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command was not found: $1" >&2
    exit 1
  fi
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

require_command curl
require_command emcc
require_command make
require_command patch
require_command tar

EMCC_VERSION=$(emcc --version | sed -n '1p')
case "$EMCC_VERSION" in
  *" $EMSCRIPTEN_VERSION"*) ;;
  *)
    echo "Expected Emscripten $EMSCRIPTEN_VERSION, but found: $EMCC_VERSION" >&2
    exit 1
    ;;
esac

echo "Downloading MicroPython $MICROPYTHON_TAG ($MICROPYTHON_COMMIT)"
curl --fail --location --silent --show-error "$MICROPYTHON_ARCHIVE_URL" --output "$SOURCE_ARCHIVE"

ACTUAL_ARCHIVE_SHA256=$(sha256_file "$SOURCE_ARCHIVE")
if [ "$ACTUAL_ARCHIVE_SHA256" != "$MICROPYTHON_ARCHIVE_SHA256" ]; then
  echo "MicroPython archive checksum did not match." >&2
  echo "Expected: $MICROPYTHON_ARCHIVE_SHA256" >&2
  echo "Actual:   $ACTUAL_ARCHIVE_SHA256" >&2
  exit 1
fi

tar -xzf "$SOURCE_ARCHIVE" -C "$BUILD_ROOT"

SOURCE_LICENSE_SHA256=$(sha256_file "$SOURCE_DIR/LICENSE")
TRACKED_LICENSE_SHA256=$(sha256_file "$CONFIGURATION_DIR/LICENSE")
if [ "$SOURCE_LICENSE_SHA256" != "$MICROPYTHON_LICENSE_SHA256" ] || \
   [ "$TRACKED_LICENSE_SHA256" != "$MICROPYTHON_LICENSE_SHA256" ]; then
  echo "MicroPython license checksum did not match." >&2
  echo "Expected:       $MICROPYTHON_LICENSE_SHA256" >&2
  echo "Source archive: $SOURCE_LICENSE_SHA256" >&2
  echo "Tracked copy:   $TRACKED_LICENSE_SHA256" >&2
  exit 1
fi

patch --batch --forward --directory "$SOURCE_DIR" -p1 \
  < "$CONFIGURATION_DIR/patches/0001-guard-external-call-depth.patch"

patch --batch --forward --directory "$SOURCE_DIR" -p1 \
  < "$CONFIGURATION_DIR/patches/0002-await-asyncify-execution.patch"

echo "Building restricted MicroPython WebAssembly runtime"
MICROPY_GIT_TAG="$MICROPYTHON_TAG" \
MICROPY_GIT_HASH="$MICROPYTHON_COMMIT" \
SOURCE_DATE_EPOCH="$MICROPYTHON_SOURCE_DATE_EPOCH" \
make -C "$SOURCE_DIR/ports/webassembly" \
  VARIANT="$WEB_LAB_BUILD_VARIANT" \
  VARIANT_DIR="$CONFIGURATION_DIR/variant" \
  BUILD="$BUILD_DIR" \
  -j "${JOBS:-4}"

mkdir -p "$OUTPUT_DIR"
install -m 0644 "$BUILD_DIR/micropython.mjs" "$OUTPUT_DIR/micropython.mjs"
install -m 0644 "$BUILD_DIR/micropython.wasm" "$OUTPUT_DIR/micropython.wasm"

{
  printf '%s  %s\n' "$(sha256_file "$OUTPUT_DIR/micropython.mjs")" \
    "src/vendor/micropython-build/micropython.mjs"
  printf '%s  %s\n' "$(sha256_file "$OUTPUT_DIR/micropython.wasm")" \
    "src/vendor/micropython-build/micropython.wasm"
} > "$BUILD_ROOT/artifacts.sha256"
install -m 0644 "$BUILD_ROOT/artifacts.sha256" "$CONFIGURATION_DIR/artifacts.sha256"

echo "Built $OUTPUT_DIR/micropython.mjs"
echo "Built $OUTPUT_DIR/micropython.wasm"
echo "Recorded $CONFIGURATION_DIR/artifacts.sha256"
