#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PREBUILT_IOS_DIR="$PACKAGE_DIR/prebuilt/ios"
XCFRAMEWORK_DIR="$PREBUILT_IOS_DIR/Moonshine.xcframework"
DEVICE_SLICE="$XCFRAMEWORK_DIR/ios-arm64"
SIMULATOR_SLICE="$XCFRAMEWORK_DIR/ios-arm64_x86_64-simulator"
NODE_BINARY="${NODE_BINARY:-node}"

if [[ -f "$DEVICE_SLICE/libmoonshine.a" ]] && [[ -f "$SIMULATOR_SLICE/libmoonshine.a" ]]; then
  exit 0
fi

PACKAGE_VERSION="$(
  cd "$PACKAGE_DIR"
  "$NODE_BINARY" -e "process.stdout.write(require('./package.json').version)"
)"
RELEASE_TAG="$(
  "$NODE_BINARY" -e "process.stdout.write(encodeURIComponent('@siteed/moonshine.rn@${PACKAGE_VERSION}'))"
)"
DEFAULT_URL="https://github.com/deeeed/audiolab/releases/download/${RELEASE_TAG}/Moonshine.xcframework.zip"
ARTIFACT_URL="${SITEED_MOONSHINE_IOS_XCFRAMEWORK_URL:-$DEFAULT_URL}"
DEFAULT_ARTIFACT_SHA256="$(
  cd "$PACKAGE_DIR"
  "$NODE_BINARY" -e "process.stdout.write(require('./package.json').moonshineArtifacts?.ios?.xcframeworkSha256 || '')"
)"
ARTIFACT_SHA256="${SITEED_MOONSHINE_IOS_XCFRAMEWORK_SHA256:-$DEFAULT_ARTIFACT_SHA256}"

if [[ -n "${SITEED_MOONSHINE_IOS_CACHE_DIR:-}" ]]; then
  CACHE_ROOT="$SITEED_MOONSHINE_IOS_CACHE_DIR"
elif [[ -n "${HOME:-}" ]] && [[ "$(uname -s)" == "Darwin" ]]; then
  CACHE_ROOT="$HOME/Library/Caches/@siteed/moonshine.rn/ios"
elif [[ -n "${XDG_CACHE_HOME:-}" ]]; then
  CACHE_ROOT="$XDG_CACHE_HOME/@siteed/moonshine.rn/ios"
elif [[ -n "${HOME:-}" ]]; then
  CACHE_ROOT="$HOME/.cache/@siteed/moonshine.rn/ios"
else
  echo "Unable to determine Moonshine iOS artifact cache directory." >&2
  echo "Set SITEED_MOONSHINE_IOS_CACHE_DIR, XDG_CACHE_HOME, or HOME." >&2
  exit 1
fi

if [[ -n "${SITEED_MOONSHINE_IOS_XCFRAMEWORK_SHA256:-}" ]] &&
  [[ -n "$DEFAULT_ARTIFACT_SHA256" ]] &&
  [[ "$SITEED_MOONSHINE_IOS_XCFRAMEWORK_SHA256" != "$DEFAULT_ARTIFACT_SHA256" ]]; then
  echo "Warning: SITEED_MOONSHINE_IOS_XCFRAMEWORK_SHA256 overrides the package-pinned checksum." >&2
  echo "Use this only for trusted mirrors or local development artifacts." >&2
fi

hash_string_sha256() {
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  else
    echo "Unable to find shasum or sha256sum for Moonshine iOS artifact hashing." >&2
    exit 1
  fi
}

hash_file_sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    echo "Unable to find shasum or sha256sum for Moonshine iOS artifact hashing." >&2
    exit 1
  fi
}

if [[ -n "$ARTIFACT_SHA256" ]]; then
  CACHE_KEY="$PACKAGE_VERSION-$ARTIFACT_SHA256"
else
  CACHE_KEY="$PACKAGE_VERSION-$(hash_string_sha256 "$ARTIFACT_URL")"
fi
CACHE_DIR="$CACHE_ROOT/$CACHE_KEY"
CACHE_ZIP_PATH="$CACHE_DIR/Moonshine.xcframework.zip"

mkdir -p "$PREBUILT_IOS_DIR"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

ZIP_PATH="$TMP_DIR/Moonshine.xcframework.zip"
echo "Moonshine iOS xcframework is not present in the npm package."
echo "Moonshine iOS artifact cache:"
echo "  $CACHE_DIR"

verify_zip_checksum() {
  local zip_path="$1"
  if [[ -n "$ARTIFACT_SHA256" ]]; then
    echo "Verifying Moonshine iOS xcframework checksum..."
    local actual_sha256
    actual_sha256="$(hash_file_sha256 "$zip_path")"
    if [[ "$actual_sha256" != "$ARTIFACT_SHA256" ]]; then
      echo "Moonshine iOS xcframework checksum mismatch." >&2
      echo "Expected: $ARTIFACT_SHA256" >&2
      echo "Actual:   $actual_sha256" >&2
      return 1
    fi
  else
    echo "Warning: Moonshine iOS xcframework checksum is not pinned." >&2
  fi
}

if [[ -f "$CACHE_ZIP_PATH" ]]; then
  echo "Using cached Moonshine iOS xcframework archive."
  if ! verify_zip_checksum "$CACHE_ZIP_PATH"; then
    echo "Discarding invalid cached Moonshine iOS xcframework archive." >&2
    rm -f "$CACHE_ZIP_PATH"
    echo "Cache entry was invalid; continuing to download path." >&2
  else
    cp "$CACHE_ZIP_PATH" "$ZIP_PATH"
  fi
fi

if [[ ! -f "$ZIP_PATH" ]]; then
  echo "Downloading Moonshine iOS xcframework:"
  echo "  $ARTIFACT_URL"
  if ! curl -fL --retry 3 --retry-delay 2 --progress-bar "$ARTIFACT_URL" -o "$ZIP_PATH"; then
    echo "Failed to download Moonshine iOS xcframework." >&2
    echo "If this is an offline or sandboxed build, seed the cache at:" >&2
    echo "  $CACHE_ZIP_PATH" >&2
    echo "or set SITEED_MOONSHINE_IOS_XCFRAMEWORK_URL to an accessible mirror." >&2
    exit 1
  fi
  if ! verify_zip_checksum "$ZIP_PATH"; then
    echo "Downloaded Moonshine iOS xcframework failed checksum verification." >&2
    exit 1
  fi
  mkdir -p "$CACHE_DIR"
  cp "$ZIP_PATH" "$CACHE_ZIP_PATH"
fi

echo "Extracting Moonshine iOS xcframework..."
unzip -q "$ZIP_PATH" -d "$TMP_DIR/unzipped"
DOWNLOADED_XCFRAMEWORK="$(find "$TMP_DIR/unzipped" -type d -name 'Moonshine.xcframework' | head -n 1)"

if [[ -z "$DOWNLOADED_XCFRAMEWORK" ]]; then
  echo "Downloaded archive does not contain Moonshine.xcframework" >&2
  exit 1
fi

rm -rf "$XCFRAMEWORK_DIR"
cp -R "$DOWNLOADED_XCFRAMEWORK" "$XCFRAMEWORK_DIR"

if [[ ! -f "$DEVICE_SLICE/libmoonshine.a" ]] || [[ ! -f "$SIMULATOR_SLICE/libmoonshine.a" ]]; then
  echo "Downloaded Moonshine.xcframework is missing required device or simulator libmoonshine.a slices" >&2
  exit 1
fi

echo "Moonshine iOS xcframework ready at $XCFRAMEWORK_DIR"
