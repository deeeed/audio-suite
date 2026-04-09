#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v llvm-readobj >/dev/null 2>&1; then
  echo "Error: llvm-readobj is required." >&2
  exit 2
fi

if ! command -v rg >/dev/null 2>&1; then
  echo "Error: rg is required." >&2
  exit 2
fi

SHERPA_JNI_LIB="${SITEED_SHERPA_ANDROID_JNI_LIB:-$ROOT_DIR/packages/sherpa-onnx.rn/android/src/main/jniLibs/arm64-v8a/libsherpa-onnx-jni.so}"
SHERPA_ORT_LIB="${SITEED_SHERPA_ANDROID_ORT_LIB:-$ROOT_DIR/packages/sherpa-onnx.rn/android/src/main/jniLibs/arm64-v8a/libonnxruntime.so}"
MOONSHINE_USE_SOURCE="${SITEED_MOONSHINE_ANDROID_USE_SOURCE:-0}"
MOONSHINE_SOURCE_AAR="${SITEED_MOONSHINE_ANDROID_SOURCE_AAR:-$ROOT_DIR/packages/moonshine.rn/prebuilt/android/moonshine-voice-source-release.aar}"
MOONSHINE_COORD="${SITEED_MOONSHINE_ANDROID_MAVEN_COORD:-ai.moonshine:moonshine-voice:0.0.51}"
MOONSHINE_REPO="${SITEED_MOONSHINE_ANDROID_MAVEN_REPO:-}"
MOONSHINE_AAR="${SITEED_MOONSHINE_ANDROID_AAR:-}"

extract_ort_symbol_version() {
  local library_path="$1"
  llvm-readobj --dyn-symbols "$library_path" 2>/dev/null \
    | rg -o 'OrtGetApiBase[^ ]*VERS_[0-9.]+' -m1 \
    | sed -E 's/.*VERS_//' \
    || true
}

sha256_file() {
  local file_path="$1"
  shasum -a 256 "$file_path" | awk '{print $1}'
}

filesize_bytes() {
  local file_path="$1"
  wc -c < "$file_path" | tr -d ' '
}

resolve_moonshine_aar() {
  if [ -n "$MOONSHINE_AAR" ]; then
    if [ ! -f "$MOONSHINE_AAR" ]; then
      echo "Error: SITEED_MOONSHINE_ANDROID_AAR points to a missing file: $MOONSHINE_AAR" >&2
      exit 2
    fi
    echo "$MOONSHINE_AAR"
    return
  fi

  if [ "$MOONSHINE_USE_SOURCE" = "1" ]; then
    if [ ! -f "$MOONSHINE_SOURCE_AAR" ]; then
      echo "Error: SITEED_MOONSHINE_ANDROID_USE_SOURCE=1 but the source-built AAR is missing: $MOONSHINE_SOURCE_AAR" >&2
      exit 2
    fi
    echo "$MOONSHINE_SOURCE_AAR"
    return
  fi

  IFS=':' read -r group artifact version <<< "$MOONSHINE_COORD"
  if [ -z "${group:-}" ] || [ -z "${artifact:-}" ] || [ -z "${version:-}" ]; then
    echo "Error: invalid Moonshine Maven coordinate: $MOONSHINE_COORD" >&2
    exit 2
  fi

  local artifact_name="${artifact}-${version}.aar"

  if [ -n "$MOONSHINE_REPO" ]; then
    local group_path="${group//./\/}"
    local repo_candidate="${MOONSHINE_REPO%/}/${group_path}/${artifact}/${version}/${artifact_name}"
    if [ -f "$repo_candidate" ]; then
      echo "$repo_candidate"
      return
    fi
  fi

  local gradle_cache="${GRADLE_USER_HOME:-$HOME/.gradle}/caches/modules-2/files-2.1/${group}/${artifact}/${version}"
  if [ -d "$gradle_cache" ]; then
    local cache_candidate
    cache_candidate="$(find "$gradle_cache" -name "$artifact_name" | head -n1)"
    if [ -n "$cache_candidate" ]; then
      echo "$cache_candidate"
      return
    fi
  fi

  echo "Error: unable to resolve Moonshine AAR for $MOONSHINE_COORD" >&2
  echo "Set SITEED_MOONSHINE_ANDROID_AAR or SITEED_MOONSHINE_ANDROID_MAVEN_REPO to make the artifact explicit." >&2
  exit 2
}

if [ ! -f "$SHERPA_JNI_LIB" ]; then
  echo "Error: missing Sherpa JNI library: $SHERPA_JNI_LIB" >&2
  exit 2
fi

if [ ! -f "$SHERPA_ORT_LIB" ]; then
  echo "Error: missing Sherpa ONNX Runtime library: $SHERPA_ORT_LIB" >&2
  exit 2
fi

MOONSHINE_AAR_PATH="$(resolve_moonshine_aar)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

unzip -p "$MOONSHINE_AAR_PATH" jni/arm64-v8a/libmoonshine.so > "$TMP_DIR/libmoonshine.so"
unzip -p "$MOONSHINE_AAR_PATH" jni/arm64-v8a/libonnxruntime.so > "$TMP_DIR/libonnxruntime.so"

SHERPA_IMPORTED_VERSION="$(extract_ort_symbol_version "$SHERPA_JNI_LIB")"
SHERPA_EXPORTED_VERSION="$(extract_ort_symbol_version "$SHERPA_ORT_LIB")"
MOONSHINE_IMPORTED_VERSION="$(extract_ort_symbol_version "$TMP_DIR/libmoonshine.so")"
SHERPA_ORT_SHA="$(sha256_file "$SHERPA_ORT_LIB")"
MOONSHINE_ORT_SHA="$(sha256_file "$TMP_DIR/libonnxruntime.so")"
SHERPA_ORT_SIZE="$(filesize_bytes "$SHERPA_ORT_LIB")"
MOONSHINE_ORT_SIZE="$(filesize_bytes "$TMP_DIR/libonnxruntime.so")"

echo "Sherpa JNI imports ORT symbol version: ${SHERPA_IMPORTED_VERSION:-unknown}"
echo "Sherpa packaged ORT exports version: ${SHERPA_EXPORTED_VERSION:-unknown}"
echo "Moonshine artifact imports ORT symbol version: ${MOONSHINE_IMPORTED_VERSION:-unknown}"
echo "Sherpa packaged ORT size: ${SHERPA_ORT_SIZE:-unknown}"
echo "Moonshine packaged ORT size: ${MOONSHINE_ORT_SIZE:-unknown}"
echo "Sherpa packaged ORT sha256: ${SHERPA_ORT_SHA:-unknown}"
echo "Moonshine packaged ORT sha256: ${MOONSHINE_ORT_SHA:-unknown}"
echo "Moonshine artifact: $MOONSHINE_AAR_PATH"

if [ -z "$SHERPA_IMPORTED_VERSION" ] || [ -z "$SHERPA_EXPORTED_VERSION" ] || [ -z "$MOONSHINE_IMPORTED_VERSION" ]; then
  echo "Error: failed to resolve one or more ORT symbol versions." >&2
  exit 2
fi

if [ "$SHERPA_IMPORTED_VERSION" != "$SHERPA_EXPORTED_VERSION" ]; then
  echo "Error: Sherpa JNI and packaged ORT do not match." >&2
  exit 1
fi

if [ "$SHERPA_IMPORTED_VERSION" != "$MOONSHINE_IMPORTED_VERSION" ]; then
  echo "Incompatible: Sherpa and Moonshine require different ORT symbol versions." >&2
  exit 1
fi

if [ "$SHERPA_ORT_SHA" != "$MOONSHINE_ORT_SHA" ]; then
  echo "Incompatible: Sherpa and Moonshine package different libonnxruntime.so binaries." >&2
  echo "Symbol versions matched, but the actual runtime libraries differ." >&2
  echo "Rebuild Sherpa so android/src/main/jniLibs and Moonshine's AAR package the same ORT binary." >&2
  exit 1
fi

echo "Compatible: Sherpa and Moonshine are aligned to ORT ${SHERPA_IMPORTED_VERSION}."
