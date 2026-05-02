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
RESULT=$(
  find "$ROOT_DIR" \
    \( \
      -path "*/node_modules/react/package.json" -o \
      -path "*/node_modules/react-dom/package.json" -o \
      -path "*/node_modules/react-native/package.json" -o \
      -path "*/node_modules/@react-navigation/native/package.json" -o \
      -path "*/node_modules/@react-navigation/native-stack/package.json" -o \
      -path "*/node_modules/@react-navigation/bottom-tabs/package.json" -o \
      -path "*/node_modules/@react-navigation/core/package.json" -o \
      -path "*/node_modules/@react-navigation/elements/package.json" \
    \) \
    -not -path "*/.git/*" 2>/dev/null \
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
