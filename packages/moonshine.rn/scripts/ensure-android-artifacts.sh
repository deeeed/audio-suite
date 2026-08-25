#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_AAR="$PACKAGE_DIR/prebuilt/android/moonshine-voice-isolated.aar"
NODE_BINARY="${NODE_BINARY:-node}"

PACKAGE_VERSION="$(cd "$PACKAGE_DIR" && "$NODE_BINARY" -e "process.stdout.write(require('./package.json').version)")"
RELEASE_TAG="$("$NODE_BINARY" -e "process.stdout.write(encodeURIComponent('@siteed/moonshine.rn@${PACKAGE_VERSION}'))")"
DEFAULT_URL="https://github.com/deeeed/audiolab/releases/download/${RELEASE_TAG}/Moonshine-Android-isolated.aar"
ARTIFACT_URL="${SITEED_MOONSHINE_ANDROID_ISOLATED_AAR_URL:-$DEFAULT_URL}"
DEFAULT_SHA256="$(cd "$PACKAGE_DIR" && "$NODE_BINARY" -e "process.stdout.write(require('./package.json').moonshineArtifacts?.android?.isolatedAarSha256 || '')")"
ARTIFACT_SHA256="${SITEED_MOONSHINE_ANDROID_ISOLATED_AAR_SHA256:-$DEFAULT_SHA256}"

if [[ -n "${SITEED_MOONSHINE_ANDROID_CACHE_DIR:-}" ]]; then
  CACHE_ROOT="$SITEED_MOONSHINE_ANDROID_CACHE_DIR"
elif [[ -n "${XDG_CACHE_HOME:-}" ]]; then
  CACHE_ROOT="$XDG_CACHE_HOME/@siteed/moonshine.rn/android"
elif [[ -n "${HOME:-}" ]]; then
  CACHE_ROOT="$HOME/.cache/@siteed/moonshine.rn/android"
else
  echo "Set SITEED_MOONSHINE_ANDROID_CACHE_DIR, XDG_CACHE_HOME, or HOME." >&2
  exit 1
fi

if [[ ! "$ARTIFACT_SHA256" =~ ^[a-fA-F0-9]{64}$ ]]; then
  echo "Moonshine Android artifact checksum is missing or invalid." >&2
  exit 1
fi

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

verify_artifact() {
  local aar_path="$1"
  [[ "$(hash_file "$aar_path")" == "$ARTIFACT_SHA256" ]] || return 1
  local entries
  entries="$(unzip -Z1 "$aar_path")"
  grep -qx 'jni/arm64-v8a/libmoonshine_onnxruntime\.so' <<< "$entries" || return 1
  ! grep -q '/libonnxruntime\.so$' <<< "$entries"
}

if [[ -f "$OUTPUT_AAR" ]] && verify_artifact "$OUTPUT_AAR"; then
  exit 0
fi

CACHE_DIR="$CACHE_ROOT/$PACKAGE_VERSION-$ARTIFACT_SHA256"
CACHE_AAR="$CACHE_DIR/Moonshine-Android-isolated.aar"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
DOWNLOADED_AAR="$TMP_DIR/Moonshine-Android-isolated.aar"

if [[ -f "$CACHE_AAR" ]] && verify_artifact "$CACHE_AAR"; then
  cp "$CACHE_AAR" "$DOWNLOADED_AAR"
fi

if [[ ! -f "$DOWNLOADED_AAR" ]]; then
  echo "Downloading isolated Moonshine Android AAR from $ARTIFACT_URL"
  curl -fL --retry 3 --retry-delay 2 --progress-bar "$ARTIFACT_URL" -o "$DOWNLOADED_AAR"
  if ! verify_artifact "$DOWNLOADED_AAR"; then
    echo "Moonshine Android artifact failed checksum or isolation validation." >&2
    exit 1
  fi
  mkdir -p "$CACHE_DIR"
  cp "$DOWNLOADED_AAR" "$CACHE_AAR"
fi

mkdir -p "$(dirname "$OUTPUT_AAR")"
cp "$DOWNLOADED_AAR" "$OUTPUT_AAR"
echo "Moonshine Android artifact ready at $OUTPUT_AAR"
