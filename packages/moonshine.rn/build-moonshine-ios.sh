#!/bin/bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPSTREAM_DIR="$SCRIPT_DIR/third_party/moonshine"
PREBUILT_DIR="$SCRIPT_DIR/prebuilt/ios"
OUTPUT_XCFRAMEWORK="$PREBUILT_DIR/Moonshine.xcframework"
METADATA_PATH="$PREBUILT_DIR/build-metadata.json"
MOONSHINE_VERSION="$(node -p "require('$SCRIPT_DIR/package.json').moonshineVersion")"
SPEAKER_EMBEDDING_DATA_CPP_OVERRIDE="${SITEED_MOONSHINE_SPEAKER_EMBEDDING_DATA_CPP:-}"
LFS_INCLUDE_PATHS="core/third-party/onnxruntime/lib/ios/**,core/third-party/onnxruntime/include/**,core/speaker-embedding-model-data.cpp"

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

if [ ! -d "$UPSTREAM_DIR/.git" ]; then
  echo -e "${RED}Error: upstream Moonshine checkout not found. Run ./setup.sh first.${NC}" >&2
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo -e "${RED}Error: xcodebuild is required to build Moonshine for iOS.${NC}" >&2
  exit 1
fi

mkdir -p "$PREBUILT_DIR"

speaker_embedding_data_path="$UPSTREAM_DIR/core/speaker-embedding-model-data.cpp"
ios_device_ort_path="$UPSTREAM_DIR/core/third-party/onnxruntime/lib/ios/arm64/libonnxruntime.a"
ios_sim_ort_path="$UPSTREAM_DIR/core/third-party/onnxruntime/lib/ios/simulator/libonnxruntime.a"
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

if is_lfs_pointer_file "$ios_device_ort_path" || is_lfs_pointer_file "$ios_sim_ort_path"; then
  needs_lfs_pull=1
fi

if [ "$needs_lfs_pull" = "1" ]; then
  if ! command -v git-lfs >/dev/null 2>&1; then
    echo -e "${RED}Error: required Moonshine iOS build assets are not materialized and git-lfs is not available.${NC}" >&2
    exit 1
  fi

  echo -e "${BLUE}Fetching required Moonshine iOS build assets via git-lfs...${NC}"
  (
    cd "$UPSTREAM_DIR"
    git lfs pull --include="$LFS_INCLUDE_PATHS"
  )
fi

echo -e "${BLUE}Moonshine iOS source build:${NC}"
echo -e "${YELLOW}  - Moonshine version: ${MOONSHINE_VERSION}${NC}"

cd "$SCRIPT_DIR"
./apply-upstream-patches.sh

CORE_DIR="$UPSTREAM_DIR/core"
CORE_BUILD_DIR="$CORE_DIR/build"
IOS_VERSION="${SITEED_MOONSHINE_IOS_DEPLOYMENT_TARGET:-16.4}"

cd "$CORE_DIR"
find . -type d -name build -exec rm -rf {} +

mkdir -p "$CORE_BUILD_DIR"
cd "$CORE_BUILD_DIR"

cmake -B build-phone \
  -G Xcode \
  -DCMAKE_SYSTEM_NAME=iOS \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$IOS_VERSION" \
  -DCMAKE_XCODE_ATTRIBUTE_CODE_SIGNING_ALLOWED=NO \
  ..
cmake --build build-phone --config Release --target moonshine

cmake -B build-simulator \
  -G Xcode \
  -DCMAKE_SYSTEM_NAME=iOS \
  -DCMAKE_OSX_SYSROOT=iphonesimulator \
  -DCMAKE_OSX_ARCHITECTURES="x86_64;arm64" \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$IOS_VERSION" \
  -DCMAKE_XCODE_ATTRIBUTE_CODE_SIGNING_ALLOWED=NO \
  ..
cmake --build build-simulator --config Release --target moonshine

MOONSHINE_FRAMEWORK_PHONE="$CORE_BUILD_DIR/build-phone/Release-iphoneos/moonshine.framework"
MOONSHINE_FRAMEWORK_SIMULATOR="$CORE_BUILD_DIR/build-simulator/Release-iphonesimulator/moonshine.framework"

if [ ! -d "$MOONSHINE_FRAMEWORK_PHONE" ] || [ ! -d "$MOONSHINE_FRAMEWORK_SIMULATOR" ]; then
  echo -e "${RED}Error: failed to locate built Moonshine iOS frameworks.${NC}" >&2
  exit 1
fi

cp "$MOONSHINE_FRAMEWORK_PHONE/moonshine" "$MOONSHINE_FRAMEWORK_PHONE/libmoonshine.a"
cp "$MOONSHINE_FRAMEWORK_SIMULATOR/moonshine" "$MOONSHINE_FRAMEWORK_SIMULATOR/libmoonshine.a"

TMP_XCFRAMEWORK="$CORE_BUILD_DIR/Moonshine.xcframework"
rm -rf "$TMP_XCFRAMEWORK"

xcodebuild -create-xcframework \
  -library "$MOONSHINE_FRAMEWORK_PHONE/libmoonshine.a" \
  -headers "$MOONSHINE_FRAMEWORK_PHONE/Headers" \
  -library "$MOONSHINE_FRAMEWORK_SIMULATOR/libmoonshine.a" \
  -headers "$MOONSHINE_FRAMEWORK_SIMULATOR/Headers" \
  -output "$TMP_XCFRAMEWORK"

for ARCH in ios-arm64 ios-arm64_x86_64-simulator; do
  HEADERS_PATH="$TMP_XCFRAMEWORK/$ARCH/Headers"
  mkdir -p "$HEADERS_PATH"
  cp "$CORE_DIR/moonshine-c-api.h" "$HEADERS_PATH/moonshine-c-api.h"
  cp "$CORE_DIR/module.modulemap" "$HEADERS_PATH/module.modulemap"
done

rm -rf "$OUTPUT_XCFRAMEWORK"
cp -R "$TMP_XCFRAMEWORK" "$OUTPUT_XCFRAMEWORK"

cat > "$METADATA_PATH" <<EOF
{
  "moonshineVersion": "${MOONSHINE_VERSION}",
  "iosFrameworkPath": "prebuilt/ios/Moonshine.xcframework",
  "speakerEmbeddingDataOverride": "$(sanitize_metadata_path "$SPEAKER_EMBEDDING_DATA_CPP_OVERRIDE")"
}
EOF

echo -e "${GREEN}Moonshine iOS xcframework built successfully.${NC}"
echo -e "${YELLOW}Output:${NC} ${OUTPUT_XCFRAMEWORK}"
