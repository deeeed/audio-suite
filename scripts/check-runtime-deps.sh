#!/bin/bash
#
# check-runtime-deps.sh
#
# Fails when packages that MUST be singletons at runtime have multiple copies
# in node_modules. Catches the duplicate-React / duplicate-react-navigation
# class of bug that breaks contexts and produces "Element type is invalid"
# errors at the navigator boundary.
#
# Excludes harmless template/type-only paths (`@expo/cli/static/...`,
# `@types/...`).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Single find walk for all singleton package paths, then group with awk.
# Prune large irrelevant trees first for speed: yarn cache, CocoaPods,
# gradle build outputs, git internals.
#
# Note on workspace attribution: a copy at `apps/x/node_modules/react` and one
# at root `node_modules/react` are intentionally treated as different workspaces
# and are NOT compared. Cross-workspace dedupe is enforced by `resolutions` and
# Metro `resolveRequest`, not by this script.
RESULT=$(
  find "$ROOT_DIR" \
    \( \
      -type d \( \
        -name .git -o \
        -name .yarn -o \
        -name Pods -o \
        -name build -o \
        -name .gradle -o \
        -name .next -o \
        -name dist \
      \) -prune \
    \) -o \
    \( \
      -path "*/node_modules/react/package.json" -o \
      -path "*/node_modules/react-dom/package.json" -o \
      -path "*/node_modules/react-native/package.json" -o \
      -path "*/node_modules/@react-navigation/native/package.json" -o \
      -path "*/node_modules/@react-navigation/native-stack/package.json" -o \
      -path "*/node_modules/@react-navigation/bottom-tabs/package.json" -o \
      -path "*/node_modules/@react-navigation/core/package.json" -o \
      -path "*/node_modules/@react-navigation/elements/package.json" \
    \) -print 2>/dev/null \
  | grep -Ev '/@expo/cli/static/|/@types/|/canary-full/|/example/' \
  | awk -F/ '
      {
        idx = 0
        for (i = 1; i <= NF; i++) if ($i == "node_modules") idx = i
        workspace = ""
        for (i = 1; i < idx; i++) workspace = workspace "/" $i
        pkg = $(idx + 1)
        if (pkg ~ /^@/) pkg = pkg "/" $(idx + 2)
        key = workspace "|" pkg
        count[key]++
        path[key, count[key]] = $0
      }
      END {
        for (k in count) if (count[k] > 1) {
          split(k, a, "|"); print "DUP " a[2] " in " a[1] " (" count[k] " copies)"
          for (i = 1; i <= count[k]; i++) print "  " path[k, i]
        }
      }
    '
)

if [[ -n "$RESULT" ]]; then
  echo "FAIL: duplicate runtime packages detected"
  echo "$RESULT"
  exit 1
fi

echo "OK: all singleton packages resolve to a single copy per workspace."
