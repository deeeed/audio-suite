#!/bin/bash
# check-swift-drift.sh
# Diffs the wrapper-owned ios/native/SherpaOnnx.swift against the pinned
# upstream copy at third_party/sherpa-onnx/swift-api-examples/SherpaOnnx.swift.
#
# Run on every upstream version bump to surface new helpers / model backends
# that may need to be back-ported into the wrapper-owned file. Drift is
# expected — this script is a notifier, not a gate.
#
# Usage:  ./scripts/check-swift-drift.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

UPSTREAM="$PACKAGE_ROOT/third_party/sherpa-onnx/swift-api-examples/SherpaOnnx.swift"
WRAPPER="$PACKAGE_ROOT/ios/native/SherpaOnnx.swift"

if [ ! -f "$UPSTREAM" ]; then
  echo "ERROR: upstream Swift file missing — run ./setup.sh first." >&2
  echo "       expected: $UPSTREAM" >&2
  exit 1
fi
if [ ! -f "$WRAPPER" ]; then
  echo "ERROR: wrapper-owned Swift file missing." >&2
  echo "       expected: $WRAPPER" >&2
  exit 1
fi

UPSTREAM_LINES="$(wc -l <"$UPSTREAM" | tr -d ' ')"
WRAPPER_LINES="$(wc -l <"$WRAPPER" | tr -d ' ')"

echo "Upstream:  $UPSTREAM ($UPSTREAM_LINES lines)"
echo "Wrapper :  $WRAPPER ($WRAPPER_LINES lines)"
echo

if diff -q "$UPSTREAM" "$WRAPPER" >/dev/null 2>&1; then
  echo "No drift — files are byte-identical."
  exit 0
fi

DIFF_LINES="$(diff -u "$UPSTREAM" "$WRAPPER" | grep -cE '^[+-][^+-]' || true)"
echo "Drift detected: $DIFF_LINES changed lines (added or removed)."
echo
echo "Use \`diff -u $UPSTREAM $WRAPPER | less\` to inspect."
echo "Hand-port any new upstream helpers / model backends into the wrapper file"
echo "so the wrapper does not regress while picking up new sherpa-onnx APIs."
