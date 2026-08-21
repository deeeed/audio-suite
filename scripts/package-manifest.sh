#!/usr/bin/env bash
# package-manifest.sh — record or verify what each package actually publishes.
#
#   scripts/package-manifest.sh          # verify against the checked-in manifests
#   scripts/package-manifest.sh --write  # regenerate them
#
# Deleting a published file, or shipping one by accident, is otherwise invisible until
# someone thinks to run `npm pack` by hand. In #455 a header that nothing in the repo
# referenced turned out to be a public CocoaPods header shipped in a 1.3.1 package, and
# only a reviewer running npm pack caught it (#459).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_DIR="$ROOT/.package-manifests"

# Packages that publish native trees, where an accidental add or delete matters most.
# audio-ui is deliberately excluded: it publishes only `dist`, so its manifest would
# record whatever the build state happens to be rather than anything about the source.
PACKAGES=(
  "packages/sherpa-onnx.rn"
  "packages/audio-studio"
)

# Prefixes dropped before comparing. These are compiler output, present or absent
# depending on whether anyone has run a build, so including them would make the check
# report a difference for a reason that has nothing to do with the change under review.
IGNORE_PREFIXES='^(build|lib|dist)/'

WRITE=false
[[ "${1:-}" == "--write" ]] && WRITE=true

mkdir -p "$MANIFEST_DIR"
status=0

for pkg in "${PACKAGES[@]}"; do
  pkg_dir="$ROOT/$pkg"
  [[ -f "$pkg_dir/package.json" ]] || { echo "skip $pkg (no package.json)"; continue; }

  name="$(node -p "require('$pkg_dir/package.json').name.replace('@','').replace('/','__')")"
  target="$MANIFEST_DIR/$name.txt"

  # --ignore-scripts so prepare/prepublish hooks cannot change what is measured.
  actual="$(cd "$pkg_dir" && npm pack --dry-run --ignore-scripts --json 2>/dev/null \
    | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
        const j=JSON.parse(d);
        console.log(j[0].files.map(f=>f.path).sort().join('\n'));
      })" | grep -Ev "$IGNORE_PREFIXES" || true)"

  if $WRITE; then
    printf '%s\n' "$actual" > "$target"
    echo "wrote $target ($(printf '%s\n' "$actual" | wc -l | tr -d ' ') files)"
    continue
  fi

  if [[ ! -f "$target" ]]; then
    echo "MISSING manifest for $pkg — run: scripts/package-manifest.sh --write" >&2
    status=1
    continue
  fi

  if diff_out="$(diff -u "$target" <(printf '%s\n' "$actual") 2>&1)"; then
    echo "ok $pkg ($(wc -l < "$target" | tr -d ' ') files)"
  else
    echo "CHANGED: $pkg publishes a different set of files than recorded." >&2
    echo "$diff_out" >&2
    echo "If intended, re-run: scripts/package-manifest.sh --write" >&2
    status=1
  fi
done

exit $status
