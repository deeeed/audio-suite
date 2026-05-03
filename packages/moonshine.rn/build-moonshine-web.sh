#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$SCRIPT_DIR"
OUTPUT_DIR="$PACKAGE_DIR/prebuilt/web"

MOONSHINE_JS_VERSION="$(node -p "require('$PACKAGE_DIR/package.json').moonshineJsVersion")"
MOONSHINE_JS_GIT_HEAD="$(node -p "require('$PACKAGE_DIR/package.json').moonshineJsGitHead")"

mkdir -p "$OUTPUT_DIR"

# Tiny + base quantized models are pulled directly from the canonical CDN; we
# do not need any moonshine-js bundle output, only its model directory layout.
mkdir -p "$OUTPUT_DIR/model/tiny/quantized"
curl -fsSL "https://download.moonshine.ai/model/tiny/quantized/encoder_model.onnx" \
  -o "$OUTPUT_DIR/model/tiny/quantized/encoder_model.onnx"
curl -fsSL "https://download.moonshine.ai/model/tiny/quantized/decoder_model_merged.onnx" \
  -o "$OUTPUT_DIR/model/tiny/quantized/decoder_model_merged.onnx"

mkdir -p "$OUTPUT_DIR/model/base/quantized"
curl -fsSL "https://download.moonshine.ai/model/base/quantized/encoder_model.onnx" \
  -o "$OUTPUT_DIR/model/base/quantized/encoder_model.onnx"
curl -fsSL "https://download.moonshine.ai/model/base/quantized/decoder_model_merged.onnx" \
  -o "$OUTPUT_DIR/model/base/quantized/decoder_model_merged.onnx"

cat > "$OUTPUT_DIR/build-metadata.json" <<EOF
{
  "moonshineJsVersion": "${MOONSHINE_JS_VERSION}",
  "moonshineJsGitHead": "${MOONSHINE_JS_GIT_HEAD}",
  "models": ["tiny", "base"],
  "source": "cdn:download.moonshine.ai",
  "generatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

echo "Moonshine web assets generated in $OUTPUT_DIR"
