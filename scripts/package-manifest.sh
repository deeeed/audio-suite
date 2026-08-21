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

PACKAGES=(
  "packages/sherpa-onnx.rn"
  "packages/audio-studio"
  "packages/audio-ui"
)

# Packages whose manifest is only meaningful after a build, because they publish compiled
# output but have no `prepare` hook for `npm pack` to trigger. audio-ui publishes `dist`
# and defines only `build`, so packing it without building lists 3 files instead of the
# ~71 it releases. Built explicitly here rather than excluded: excluding it was how an
# earlier version of this script ended up unable to see published files at all.
declare -a NEEDS_BUILD=("packages/audio-ui")

WRITE=false
[[ "${1:-}" == "--write" ]] && WRITE=true

mkdir -p "$MANIFEST_DIR"
status=0

for pkg in "${PACKAGES[@]}"; do
  pkg_dir="$ROOT/$pkg"
  if [[ ! -f "$pkg_dir/package.json" ]]; then
    # Not a skip: a configured package that has lost its metadata means the manifest
    # on disk describes something that no longer exists, and passing here would leave
    # that stale file unchallenged.
    echo "FATAL: $pkg has no package.json but is configured for manifesting." >&2
    exit 1
  fi

  for needs in "${NEEDS_BUILD[@]}"; do
    if [[ "$pkg" == "$needs" ]]; then
      echo "building $pkg (no prepare hook; npm pack would not produce its dist)" >&2
      if ! (cd "$pkg_dir" && yarn build >/dev/null 2>&1); then
        echo "FATAL: build failed for $pkg." >&2
        exit 1
      fi
    fi
  done

  name="$(node -p "require('$pkg_dir/package.json').name.replace('@','').replace('/','__')")"
  target="$MANIFEST_DIR/$name.txt"

  # The real publish lifecycle, not --ignore-scripts. Build output IS published — an
  # earlier version of this script excluded build/, lib/ and dist/ to dodge the fact that
  # a skip-build CI checkout has none of it, and that exclusion masked exactly what this
  # check exists to catch: a rogue build/rogue.js appeared in `npm pack` while
  # verification passed. Running prepare makes the output real and the list complete.
  if ! pack_json="$(cd "$pkg_dir" && npm pack --dry-run --json 2>/dev/null)"; then
    echo "FATAL: npm pack failed for $pkg." >&2
    exit 1
  fi

  # The prepare scripts print build progress to stdout, so the JSON array is not the
  # whole stream — parse from the first '[' at column 0 rather than assuming.
  if ! actual="$(printf '%s' "$pack_json" | node -e "
      let d='';
      process.stdin.on('data', c => d += c).on('end', () => {
        const start = d.indexOf('\n[');
        const j = JSON.parse(start === -1 ? d : d.slice(start + 1));
        if (!Array.isArray(j) || !j[0] || !Array.isArray(j[0].files) || !j[0].files.length) {
          process.exit(1);
        }
        console.log(j[0].files.map(f => f.path).sort().join('\n'));
      });
    ")"; then
    echo "FATAL: could not parse npm pack output for $pkg (or it listed no files)." >&2
    exit 1
  fi

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
