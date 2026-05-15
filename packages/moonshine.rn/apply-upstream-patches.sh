#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPSTREAM_DIR="$SCRIPT_DIR/third_party/moonshine"
PATCHES=(
  "patches/OrtAndroidOverrides.patch"
  "patches/LongStreamingMemory.patch"
)

if [ ! -d "$UPSTREAM_DIR/.git" ]; then
  echo "Error: upstream Moonshine checkout is missing. Run ./setup.sh first." >&2
  exit 1
fi

cd "$UPSTREAM_DIR"

for relative_patch_path in "${PATCHES[@]}"; do
  patch_path="$SCRIPT_DIR/$relative_patch_path"

  if [ ! -f "$patch_path" ]; then
    echo "Error: missing patch file: $patch_path" >&2
    exit 1
  fi

  if git apply --3way --check "$patch_path" >/dev/null 2>&1; then
    echo "Applying upstream patch: $relative_patch_path"
    git apply --3way "$patch_path"
    if find . -name '*.rej' -print -quit | grep -q .; then
      echo "Error: patch left reject files after 3-way apply: $relative_patch_path" >&2
      exit 1
    fi
    continue
  fi

  if git apply --reverse --check "$patch_path" >/dev/null 2>&1; then
    echo "Upstream patch already applied: $relative_patch_path"
    continue
  fi

  echo "Error: failed to apply upstream patch cleanly: $relative_patch_path" >&2
  echo "Refresh the patch against the pinned Moonshine version before building." >&2
  exit 1
done
