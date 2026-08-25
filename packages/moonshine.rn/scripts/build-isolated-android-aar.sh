#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_VERSION="${SITEED_MOONSHINE_ANDROID_SOURCE_VERSION:-0.1.5}"
SOURCE_SHA256="${SITEED_MOONSHINE_ANDROID_SOURCE_SHA256:-ee2d95c21150683c743db8f3aef66281fd5408bcefc94be3ca1d2545ada1f571}"
SOURCE_URL="${SITEED_MOONSHINE_ANDROID_SOURCE_URL:-https://repo1.maven.org/maven2/ai/moonshine/moonshine-voice/${SOURCE_VERSION}/moonshine-voice-${SOURCE_VERSION}.aar}"
OUTPUT_AAR="${SITEED_MOONSHINE_ANDROID_ISOLATED_OUTPUT:-$PACKAGE_DIR/prebuilt/android/moonshine-voice-isolated.aar}"
PRIVATE_ORT="libmoonshine_onnxruntime.so"

if ! command -v patchelf >/dev/null 2>&1; then
  echo "patchelf is required to build the isolated Moonshine Android AAR." >&2
  exit 1
fi

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
SOURCE_AAR="$TMP_DIR/moonshine-voice.aar"

if [[ -n "${SITEED_MOONSHINE_ANDROID_SOURCE_AAR:-}" ]]; then
  cp "$SITEED_MOONSHINE_ANDROID_SOURCE_AAR" "$SOURCE_AAR"
else
  curl -fL --retry 3 --retry-delay 2 "$SOURCE_URL" -o "$SOURCE_AAR"
fi

ACTUAL_SOURCE_SHA256="$(hash_file "$SOURCE_AAR")"
if [[ "$ACTUAL_SOURCE_SHA256" != "$SOURCE_SHA256" ]]; then
  echo "Moonshine source AAR checksum mismatch." >&2
  echo "Expected: $SOURCE_SHA256" >&2
  echo "Actual:   $ACTUAL_SOURCE_SHA256" >&2
  exit 1
fi

STAGE_DIR="$TMP_DIR/stage"
mkdir -p "$STAGE_DIR"
unzip -q "$SOURCE_AAR" -d "$STAGE_DIR"

PATCHED_ABIS=0
for ABI_DIR in "$STAGE_DIR"/jni/*; do
  [[ -d "$ABI_DIR" ]] || continue
  ORT_PATH="$ABI_DIR/libonnxruntime.so"
  [[ -f "$ORT_PATH" ]] || {
    echo "Moonshine source AAR is missing ${ABI_DIR#"$STAGE_DIR"/}/libonnxruntime.so" >&2
    exit 1
  }
  mv "$ORT_PATH" "$ABI_DIR/$PRIVATE_ORT"
  patchelf --set-soname "$PRIVATE_ORT" "$ABI_DIR/$PRIVATE_ORT"

  for CONSUMER_NAME in libmoonshine.so libmoonshine-jni.so; do
    CONSUMER="$ABI_DIR/$CONSUMER_NAME"
    [[ -f "$CONSUMER" ]] || {
      echo "Moonshine source AAR is missing ${CONSUMER#"$STAGE_DIR"/}" >&2
      exit 1
    }
    patchelf --replace-needed libonnxruntime.so "$PRIVATE_ORT" "$CONSUMER"
    if patchelf --print-needed "$CONSUMER" | grep -qx 'libonnxruntime.so'; then
      echo "Failed to isolate ONNX Runtime for ${CONSUMER#"$STAGE_DIR"/}" >&2
      exit 1
    fi
    patchelf --print-needed "$CONSUMER" | grep -qx "$PRIVATE_ORT"
  done

  [[ "$(patchelf --print-soname "$ABI_DIR/$PRIVATE_ORT")" == "$PRIVATE_ORT" ]]
  PATCHED_ABIS=$((PATCHED_ABIS + 1))
done

if [[ "$PATCHED_ABIS" -eq 0 ]]; then
  echo "Moonshine source AAR contains no Android JNI directories." >&2
  exit 1
fi

# Keep the release asset byte-for-byte reproducible across rebuilds.
find "$STAGE_DIR" -type f -exec touch -t 198001010000 {} +
mkdir -p "$(dirname "$OUTPUT_AAR")"
rm -f "$OUTPUT_AAR"
(
  cd "$STAGE_DIR"
  find . -type f -print | LC_ALL=C sort | zip -X -q "$OUTPUT_AAR" -@
)

echo "Built isolated Moonshine Android AAR for $PATCHED_ABIS ABI(s)."
echo "Output: $OUTPUT_AAR"
echo "SHA-256: $(hash_file "$OUTPUT_AAR")"
