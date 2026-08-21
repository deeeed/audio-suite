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

# Every workspace under packages/ that is actually published (not "private": true),
# discovered rather than hand-listed: a hard-coded list silently omits new packages, and
# omitted moonshine.rn and react-native-essentia when it was one.
PACKAGES=()
while IFS= read -r pkg_json; do
  dir="$(dirname "${pkg_json#"$ROOT/"}")"
  is_private="$(node -p "require('$pkg_json').private === true" 2>/dev/null || echo true)"
  [[ "$is_private" == "true" ]] && continue
  PACKAGES+=("$dir")
done < <(find "$ROOT/packages" -maxdepth 2 -name package.json -not -path "*/node_modules/*" | sort)

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
        // A prepare script can print bracketed tags like [prepare], so the first '['
        // is not reliably the JSON. Try each candidate offset and keep the one that
        // parses into the expected shape.
        let j = null;
        for (let i = d.indexOf('['); i !== -1; i = d.indexOf('[', i + 1)) {
          try {
            const cand = JSON.parse(d.slice(i));
            if (Array.isArray(cand) && cand[0] && Array.isArray(cand[0].files)) { j = cand; break; }
          } catch { /* not the start of the payload */ }
        }
        if (!j) process.exit(1);
        if (!j[0].files.length) process.exit(1);
        console.log(j[0].files.map(f => f.path).sort().join('\n'));
      });
    ")"; then
    echo "FATAL: could not parse npm pack output for $pkg (or it listed no files)." >&2
    exit 1
  fi

  # Untracked published paths. `npm pack` includes them when a local build has produced
  # them and omits them otherwise, so they cannot be part of a stable manifest — recording
  # them makes every clean checkout fail. They are reported rather than dropped silently:
  # a package publishing files that no clean checkout can reproduce is worth knowing about.
  untracked_published=""
  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    if ! git -C "$ROOT" ls-files --error-unmatch "$pkg/$rel" >/dev/null 2>&1; then
      case "$rel" in
        build/*|lib/*|dist/*|plugin/build/*) ;;   # produced by prepare, always reproducible
        *) untracked_published+="$rel"$'\n' ;;
      esac
    fi
  done <<< "$actual"

  if [[ -n "$untracked_published" ]]; then
    count="$(printf '%s' "$untracked_published" | grep -c . || true)"
    echo "note: $pkg publishes $count file(s) that are untracked and not build output;" >&2
    echo "      excluded from the manifest because npm pack only sees them after a native build:" >&2
    printf '%s' "$untracked_published" | sed 's/^/        /' >&2
    actual="$(printf '%s\n' "$actual" | grep -vxF -f <(printf '%s' "$untracked_published") || true)"
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

# Reconcile the other direction: a manifest whose package has been deleted or marked
# private drops out of PACKAGES entirely, so nothing above ever looks at it and it lingers
# describing a package that no longer publishes.
expected=""
for pkg in "${PACKAGES[@]}"; do
  expected+="$(node -p "require('$ROOT/$pkg/package.json').name.replace('@','').replace('/','__')").txt"$'\n'
done

for manifest in "$MANIFEST_DIR"/*.txt; do
  [[ -e "$manifest" ]] || continue
  base="$(basename "$manifest")"
  if ! printf '%s' "$expected" | grep -qxF "$base"; then
    if $WRITE; then
      rm -f "$manifest"
      echo "removed $base (no longer a published package)"
    else
      echo "ORPHAN: $base has no matching published package." >&2
      echo "If intended, re-run: scripts/package-manifest.sh --write" >&2
      status=1
    fi
  fi
done

exit $status
