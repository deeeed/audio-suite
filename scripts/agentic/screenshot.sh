#!/bin/bash
# Take a screenshot via the unified CDP bridge.
# Platform detection and device resolution happen inside cdp-bridge.mjs.
#
# Usage:
#   screenshot.sh [--device <name>] [label]
#
# Output: prints JSON with { screenshot: <absolute-path>, deviceName, platform }
#         When multiple devices are connected, broadcasts to all (or use --device).
#
# Keeps the last 20 screenshots (managed by cdp-bridge.mjs).

set -euo pipefail
APP_ROOT="${APP_ROOT:-$(pwd)}"
source "$(cd "$APP_ROOT" && git rev-parse --show-toplevel)/scripts/agentic/_lib.sh"
cd "$APP_ROOT"

# -- Parse --device flag and positional args --------------------------------
# Bash 3.2 errors on "${empty[@]}" under `set -u`, so keep a placeholder
# element and expand from index 1. A plain string word-splits on a device
# name containing a space, which silently corrupted the caller's arguments.
DEVICE_ARGS=("")
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --device)
      DEVICE_ARGS=("" --device "$2")
      shift 2
      ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

LABEL="${POSITIONAL[0]:-screenshot}"

# shellcheck disable=SC2086
WATCHER_PORT="$PORT" node "${APP_ROOT}/scripts/agentic/cdp-bridge.mjs" "${DEVICE_ARGS[@]:1}" screenshot "$LABEL"
