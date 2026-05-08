#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PREBUILT_IOS_DIR="$PACKAGE_DIR/prebuilt/ios"
XCFRAMEWORK_DIR="$PREBUILT_IOS_DIR/Moonshine.xcframework"
DEVICE_SLICE="$XCFRAMEWORK_DIR/ios-arm64"
SIMULATOR_SLICE="$XCFRAMEWORK_DIR/ios-arm64_x86_64-simulator"

if [ -d "$DEVICE_SLICE" ] && [ -d "$SIMULATOR_SLICE" ]; then
  exit 0
fi

PACKAGE_VERSION="$(
  cd "$PACKAGE_DIR"
  node -e "process.stdout.write(require('./package.json').version)"
)"
RELEASE_TAG="$(
  node -e "process.stdout.write(encodeURIComponent('@siteed/moonshine.rn@${PACKAGE_VERSION}'))"
)"
DEFAULT_URL="https://github.com/deeeed/audiolab/releases/download/${RELEASE_TAG}/Moonshine.xcframework.zip"
ARTIFACT_URL="${SITEED_MOONSHINE_IOS_XCFRAMEWORK_URL:-$DEFAULT_URL}"
ARTIFACT_SHA256="${SITEED_MOONSHINE_IOS_XCFRAMEWORK_SHA256:-}"

mkdir -p "$PREBUILT_IOS_DIR"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

ZIP_PATH="$TMP_DIR/Moonshine.xcframework.zip"
echo "Moonshine iOS xcframework is not present in the npm package."
echo "Downloading Moonshine iOS xcframework:"
echo "  $ARTIFACT_URL"
curl -fL --retry 3 --retry-delay 2 --progress-bar "$ARTIFACT_URL" -o "$ZIP_PATH"

if [ -n "$ARTIFACT_SHA256" ]; then
  echo "Verifying Moonshine iOS xcframework checksum..."
  ACTUAL_SHA256="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"
  if [ "$ACTUAL_SHA256" != "$ARTIFACT_SHA256" ]; then
    echo "Moonshine iOS xcframework checksum mismatch." >&2
    echo "Expected: $ARTIFACT_SHA256" >&2
    echo "Actual:   $ACTUAL_SHA256" >&2
    exit 1
  fi
fi

echo "Extracting Moonshine iOS xcframework..."
unzip -q "$ZIP_PATH" -d "$TMP_DIR/unzipped"
DOWNLOADED_XCFRAMEWORK="$(find "$TMP_DIR/unzipped" -type d -name 'Moonshine.xcframework' | head -n 1)"

if [ -z "$DOWNLOADED_XCFRAMEWORK" ]; then
  echo "Downloaded archive does not contain Moonshine.xcframework" >&2
  exit 1
fi

rm -rf "$XCFRAMEWORK_DIR"
cp -R "$DOWNLOADED_XCFRAMEWORK" "$XCFRAMEWORK_DIR"

if [ ! -f "$DEVICE_SLICE/libmoonshine.a" ] || [ ! -f "$SIMULATOR_SLICE/libmoonshine.a" ]; then
  echo "Downloaded Moonshine.xcframework is missing required device or simulator libmoonshine.a slices" >&2
  exit 1
fi

echo "Moonshine iOS xcframework ready at $XCFRAMEWORK_DIR"
