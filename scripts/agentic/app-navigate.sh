#!/bin/bash
# Navigate the running app to a specific screen via CDP bridge.
# Returns JSON with previousRoute, currentRoute, deviceName, platform.
# Optionally takes a verification screenshot (--screenshot).
#
# Usage:
#   app-navigate.sh <route-path>
#   app-navigate.sh --screenshot <route-path>
#   app-navigate.sh --device "Pixel 6a" /(tabs)/record

set -euo pipefail
APP_ROOT="${APP_ROOT:-$(pwd)}"
source "$(cd "$APP_ROOT" && git rev-parse --show-toplevel)/scripts/agentic/_lib.sh"
cd "$APP_ROOT"

# -- Parse flags -----------------------------------------------------------
TAKE_SCREENSHOT=false
# Bash 3.2 errors on "${empty[@]}" under `set -u`, so keep a placeholder
# element and expand from index 1. A plain string word-splits on a device
# name containing a space, which silently corrupted the caller's arguments.
DEVICE_ARGS=("")
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --screenshot) TAKE_SCREENSHOT=true; shift ;;
    --device)
      DEVICE_ARGS=("" --device "$2")
      shift 2
      ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

ROUTE="${POSITIONAL[0]:-}"
if [ -z "$ROUTE" ]; then
  echo "Usage: app-navigate.sh [--screenshot] [--device <name>] <route-path>"
  echo ""
  echo "Options:"
  echo "  --screenshot           Take a verification screenshot after navigating"
  echo "  --device <name>        Target a specific device (substring match)"
  echo ""
  echo "Common routes:"
  echo "$AGENTIC_ROUTES"
  exit 1
fi

# -- Navigate via unified CDP bridge ----------------------------------------
echo "Navigating to $ROUTE..."

# shellcheck disable=SC2086
RESULT=$(WATCHER_PORT="$PORT" node "${APP_ROOT}/scripts/agentic/cdp-bridge.mjs" "${DEVICE_ARGS[@]:1}" navigate "$ROUTE" 2>&1)
echo "$RESULT"

# -- Optional screenshot (opt-in with --screenshot) ------------------------
if [ "$TAKE_SCREENSHOT" = true ]; then
  sleep 1
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  SCREENSHOT=$(APP_ROOT="$APP_ROOT" bash "${SCRIPT_DIR}/screenshot.sh" "${DEVICE_ARGS[@]:1}" "nav-${ROUTE//\//_}" 2>&1) || true
  if [ -n "$SCREENSHOT" ]; then
    echo "Screenshot: $SCREENSHOT"
  fi
fi
