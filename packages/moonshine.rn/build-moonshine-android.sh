#!/bin/bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPSTREAM_DIR="$SCRIPT_DIR/third_party/moonshine"
PREBUILT_DIR="$SCRIPT_DIR/prebuilt/android"
OUTPUT_AAR="$PREBUILT_DIR/moonshine-voice-source-release.aar"
METADATA_PATH="$PREBUILT_DIR/build-metadata.json"
ABI="${SITEED_MOONSHINE_ANDROID_ABI:-arm64-v8a}"
ABI_LIST="${SITEED_MOONSHINE_ANDROID_ABIS:-$ABI}"
ORT_VERSION="${SITEED_MOONSHINE_ORT_VERSION:-upstream-bundled}"
MOONSHINE_VERSION="$(node -p "require('$SCRIPT_DIR/package.json').moonshineVersion")"
LFS_INCLUDE_PATHS="core/third-party/onnxruntime/lib/android/**,core/speaker-embedding-model-data.cpp"
SPEAKER_EMBEDDING_DATA_CPP_OVERRIDE="${SITEED_MOONSHINE_SPEAKER_EMBEDDING_DATA_CPP:-}"

sanitize_metadata_path() {
  local raw_path="$1"
  if [ -z "$raw_path" ]; then
    echo ""
    return
  fi

  if [[ "$raw_path" == "$SCRIPT_DIR/"* ]]; then
    echo "${raw_path#$SCRIPT_DIR/}"
    return
  fi

  if [[ "$raw_path" == "$UPSTREAM_DIR/"* ]]; then
    echo "third_party/moonshine/${raw_path#$UPSTREAM_DIR/}"
    return
  fi

  echo "[external override]"
}

decouple_bundled_ort_in_aar() {
  # Strip the only versioned ORT symbol moonshine imports so libmoonshine.so
  # accepts any libonnxruntime.so the host APK ships. Without this, a
  # multi-package APK that also pulls in sherpa-onnx.rn (which bundles ORT
  # 1.24.x) ends up with both packages providing lib/arm64-v8a/libonnxruntime.so
  # — gradle pickFirst silently drops one, and if sherpa's wins, moonshine's
  # `OrtGetApiBase@VERS_1.23.0` lookup fails and dlopen reports
  # "Failed to load moonshine-jni library".
  #
  # `OrtGetApiBase` is moonshine's only versioned ORT import; every later ORT
  # call goes through the C API table that function returns. Clearing its
  # version requirement makes the lookup match any ORT default-version export
  # (sherpa's `OrtGetApiBase@@VERS_1.24.3`, our own `@@VERS_1.23.0`, etc).
  # The host ORT must be >= 1.23 (the API version moonshine was compiled
  # against); older runtimes hand back an API table missing entries
  # libmoonshine.so will dereference.
  #
  # The AAR keeps shipping its own libonnxruntime.so so standalone consumers
  # (apps that pull in only moonshine.rn) still load successfully. Apps that
  # also include sherpa-onnx.rn typically rely on AGP's default duplicate-lib
  # handling; if a build fails on duplicate libonnxruntime.so, the consumer
  # can add `packagingOptions.pickFirst "**/libonnxruntime.so"` in app
  # build.gradle.
  local aar_path="$1"
  if ! command -v patchelf >/dev/null 2>&1; then
    echo -e "${RED}Error: patchelf is required to clear the ONNX Runtime symbol version.${NC}" >&2
    echo -e "${RED}Install with 'brew install patchelf' (macOS) or 'apt-get install patchelf' (Linux).${NC}" >&2
    exit 1
  fi

  local stage="$(mktemp -d)"

  unzip -q "$aar_path" -d "$stage"
  local jni_dir="$stage/jni"
  if [ ! -d "$jni_dir" ]; then
    rm -rf "$stage"
    return
  fi

  local touched=0
  for abi_dir in "$jni_dir"/*; do
    [ -d "$abi_dir" ] || continue
    for consumer in "$abi_dir/libmoonshine.so" "$abi_dir/libmoonshine-jni.so"; do
      [ -f "$consumer" ] || continue
      patchelf --clear-symbol-version OrtGetApiBase "$consumer"
      touched=1
    done
  done

  if [ "$touched" = "0" ]; then
    rm -rf "$stage"
    return
  fi

  rm -f "$aar_path"
  ( cd "$stage" && zip -qr "$aar_path" . )
  rm -rf "$stage"
}

extract_ort_symbol_version() {
  local library_path="$1"
  if ! command -v llvm-readobj >/dev/null 2>&1; then
    echo "unknown"
    return
  fi

  # grep -oE + head, not `rg -o -m1`: ripgrep is undeclared and absent from a stock
  # macOS or CI image, and `|| true` here would turn its absence into an empty version
  # string rather than a failure (#443).
  llvm-readobj --dyn-symbols "$library_path" 2>/dev/null \
    | grep -oE 'OrtGetApiBase[^ ]*VERS_[0-9.]+' \
    | head -1 \
    | sed -E 's/.*VERS_//' \
    || true
}

if [ ! -d "$UPSTREAM_DIR/.git" ]; then
  echo -e "${RED}Error: upstream Moonshine checkout not found. Run ./setup.sh first.${NC}" >&2
  exit 1
fi

mkdir -p "$PREBUILT_DIR"

resolve_abi_dir() {
  case "$1" in
    armeabi-v7a) echo "armeabi-v7a" ;;
    arm64-v8a) echo "arm64" ;;
    x86) echo "x86" ;;
    x86_64) echo "x86_64" ;;
    *)
      echo "Error: unsupported ABI for Moonshine source build: $1" >&2
      exit 1
      ;;
  esac
}

is_lfs_pointer_file() {
  local file_path="$1"
  if [ ! -f "$file_path" ]; then
    return 0
  fi

  if [ "$(wc -c < "$file_path" | tr -d ' ')" -lt 1024 ]; then
    # grep, not rg: ripgrep is not declared as a dependency and is absent from a stock
    # macOS or CI image. Inside an `if` under `set -e`, a missing binary makes the
    # condition false rather than aborting, so an unmaterialized pointer file would be
    # treated as real content and this guard would silently never fire (#443).
    if grep -q '^version https://git-lfs.github.com/spec/v1' "$file_path"; then
      return 0
    fi
  fi

  return 1
}

ORT_LIB_PATH="${SITEED_MOONSHINE_ORT_LIB_PATH:-}"
ORT_INCLUDE_DIR="${SITEED_MOONSHINE_ORT_INCLUDE_DIR:-}"

if [ -z "$ORT_LIB_PATH" ] || [ -z "$ORT_INCLUDE_DIR" ]; then
  if [ -n "${SITEED_MOONSHINE_ORT_ROOT:-}" ]; then
    ort_abi_dir="$(resolve_abi_dir "$ABI")"
    ORT_LIB_PATH="${ORT_LIB_PATH:-${SITEED_MOONSHINE_ORT_ROOT%/}/lib/android/${ort_abi_dir}/libonnxruntime.so}"
    ORT_INCLUDE_DIR="${ORT_INCLUDE_DIR:-${SITEED_MOONSHINE_ORT_ROOT%/}/include}"
  else
    if [ -n "${SITEED_MOONSHINE_ORT_LIB_DIR:-}" ]; then
      ORT_LIB_PATH="${ORT_LIB_PATH:-${SITEED_MOONSHINE_ORT_LIB_DIR%/}/libonnxruntime.so}"
    fi
    if [ -n "${SITEED_MOONSHINE_ORT_INCLUDE_DIR:-}" ]; then
      ORT_INCLUDE_DIR="${SITEED_MOONSHINE_ORT_INCLUDE_DIR}"
    fi
  fi
fi

if [ -n "$ORT_LIB_PATH" ] && [ ! -f "$ORT_LIB_PATH" ]; then
  echo -e "${RED}Error: Moonshine ORT library override not found: $ORT_LIB_PATH${NC}" >&2
  exit 1
fi

if [ -n "$ORT_INCLUDE_DIR" ] && [ ! -d "$ORT_INCLUDE_DIR" ]; then
  echo -e "${RED}Error: Moonshine ORT include override not found: $ORT_INCLUDE_DIR${NC}" >&2
  exit 1
fi

echo -e "${BLUE}Moonshine Android source build:${NC}"
echo -e "${YELLOW}  - ABI(s): ${ABI_LIST}${NC}"
echo -e "${YELLOW}  - ORT version hint: ${ORT_VERSION}${NC}"
if [ -n "$ORT_LIB_PATH" ]; then
  echo -e "${YELLOW}  - ORT lib override: ${ORT_LIB_PATH}${NC}"
fi
if [ -n "$ORT_INCLUDE_DIR" ]; then
  echo -e "${YELLOW}  - ORT include override: ${ORT_INCLUDE_DIR}${NC}"
fi

cd "$SCRIPT_DIR"
./apply-upstream-patches.sh

cd "$UPSTREAM_DIR"
export SITEED_MOONSHINE_ANDROID_ABIS="$ABI_LIST"
if [ -n "$ORT_LIB_PATH" ]; then
  export SITEED_MOONSHINE_ORT_LIB_PATH="$ORT_LIB_PATH"
fi
if [ -n "$ORT_INCLUDE_DIR" ]; then
  export SITEED_MOONSHINE_ORT_INCLUDE_DIR="$ORT_INCLUDE_DIR"
fi

speaker_embedding_data_path="$UPSTREAM_DIR/core/speaker-embedding-model-data.cpp"
vendored_ort_path="$UPSTREAM_DIR/core/third-party/onnxruntime/lib/android/$(resolve_abi_dir "$ABI")/libonnxruntime.so"
needs_lfs_pull=0

if is_lfs_pointer_file "$speaker_embedding_data_path"; then
  if [ -n "$SPEAKER_EMBEDDING_DATA_CPP_OVERRIDE" ]; then
    if [ ! -f "$SPEAKER_EMBEDDING_DATA_CPP_OVERRIDE" ]; then
      echo -e "${RED}Error: SITEED_MOONSHINE_SPEAKER_EMBEDDING_DATA_CPP points to a missing file: $SPEAKER_EMBEDDING_DATA_CPP_OVERRIDE${NC}" >&2
      exit 1
    fi
    cp "$SPEAKER_EMBEDDING_DATA_CPP_OVERRIDE" "$speaker_embedding_data_path"
  fi
fi

if is_lfs_pointer_file "$speaker_embedding_data_path"; then
  needs_lfs_pull=1
fi

if [ -z "$ORT_LIB_PATH" ] && is_lfs_pointer_file "$vendored_ort_path"; then
  needs_lfs_pull=1
fi

if [ "$needs_lfs_pull" = "1" ]; then
  if ! command -v git-lfs >/dev/null 2>&1; then
    echo -e "${RED}Error: required Moonshine LFS assets are not materialized and git-lfs is not available.${NC}" >&2
    echo -e "${RED}Provide SITEED_MOONSHINE_ORT_LIB_PATH/SITEED_MOONSHINE_ORT_INCLUDE_DIR or install git-lfs.${NC}" >&2
    exit 1
  fi

  echo -e "${BLUE}Fetching required Moonshine build assets via git-lfs...${NC}"
  git lfs pull --include="$LFS_INCLUDE_PATHS"
fi

# core/CMakeLists.txt lists speaker-embedding-model-data.cpp unconditionally. It is
# an LFS file at the pinned commit, so the pull above normally materializes it, but
# it does not exist at every upstream tag — a checkout moved off the pinned commit
# resolves to a tree without it. Without this check gradle fails ~80s later with an
# opaque CMake "Cannot find source file". Fail now, naming the override instead.
if is_lfs_pointer_file "$speaker_embedding_data_path"; then
  echo -e "${RED}Error: $speaker_embedding_data_path is missing or is an unmaterialized LFS pointer.${NC}" >&2
  echo -e "${RED}Confirm third_party/moonshine is on the pinned commit and git-lfs fetched it,${NC}" >&2
  echo -e "${RED}or point SITEED_MOONSHINE_SPEAKER_EMBEDDING_DATA_CPP at a copy of the file.${NC}" >&2
  exit 1
fi

./gradlew clean assembleRelease -Pandroid.useAndroidX=true

AAR_SOURCE="$(find "$UPSTREAM_DIR/build/outputs/aar" -maxdepth 1 -name '*release.aar' | head -n1)"
if [ -z "$AAR_SOURCE" ] || [ ! -f "$AAR_SOURCE" ]; then
  echo -e "${RED}Error: failed to locate built Moonshine release AAR.${NC}" >&2
  exit 1
fi

cp "$AAR_SOURCE" "$OUTPUT_AAR"

decouple_bundled_ort_in_aar "$OUTPUT_AAR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

MOONSHINE_IMPORTED_ORT_VERSION="unknown"
MOONSHINE_PACKAGED_ORT_VERSION="unknown"
if unzip -p "$OUTPUT_AAR" jni/arm64-v8a/libmoonshine.so > "$TMP_DIR/libmoonshine.so" 2>/dev/null; then
  MOONSHINE_IMPORTED_ORT_VERSION="$(extract_ort_symbol_version "$TMP_DIR/libmoonshine.so")"
  # decouple_bundled_ort_in_aar strips the version requirement from the only
  # versioned ORT import. Report that explicitly so metadata isn't misleading.
  if [ -z "$MOONSHINE_IMPORTED_ORT_VERSION" ]; then
    MOONSHINE_IMPORTED_ORT_VERSION="stripped"
  fi
fi
if unzip -p "$OUTPUT_AAR" jni/arm64-v8a/libonnxruntime.so > "$TMP_DIR/libonnxruntime.so" 2>/dev/null; then
  MOONSHINE_PACKAGED_ORT_VERSION="$(extract_ort_symbol_version "$TMP_DIR/libonnxruntime.so")"
fi
AAR_SHA256="$(shasum -a 256 "$OUTPUT_AAR" | awk '{print $1}')"

cat > "$METADATA_PATH" <<EOF
{
  "moonshineVersion": "${MOONSHINE_VERSION}",
  "androidAbis": "${ABI_LIST}",
  "onnxRuntimeVersionHint": "${ORT_VERSION}",
  "onnxRuntimeLibPathOverride": "$(sanitize_metadata_path "$ORT_LIB_PATH")",
  "onnxRuntimeIncludeDirOverride": "$(sanitize_metadata_path "$ORT_INCLUDE_DIR")",
  "arm64ImportedOrtSymbolVersion": "${MOONSHINE_IMPORTED_ORT_VERSION}",
  "arm64PackagedOrtSymbolVersion": "${MOONSHINE_PACKAGED_ORT_VERSION}",
  "aarSha256": "${AAR_SHA256}"
}
EOF

echo -e "${GREEN}Moonshine Android source AAR built successfully.${NC}"
echo -e "${YELLOW}Output:${NC} ${OUTPUT_AAR}"
