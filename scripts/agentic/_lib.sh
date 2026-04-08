#!/bin/bash
# _lib.sh — Shared library for agentic scripts.
# Sources the calling app's agentic.conf and provides common helpers.
#
# Usage: source this file from a shared script after cd-ing to the app root.
#   cd "$(dirname "$0")/../.."   # app root
#   source "$(git rev-parse --show-toplevel)/scripts/agentic/_lib.sh"

# APP_ROOT must be set by the caller (the app's thin wrapper does cd first)
APP_ROOT="${APP_ROOT:-$(pwd)}"
MONOREPO_ROOT="$(cd "$APP_ROOT" && git rev-parse --show-toplevel)"

# Source app-specific config
_CONF="${APP_ROOT}/scripts/agentic/agentic.conf"
if [ ! -f "$_CONF" ]; then
  echo "ERROR: agentic.conf not found at $_CONF" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$_CONF"

# Resolve runtime values (env overrides config)
PORT="${WATCHER_PORT:-$AGENTIC_PORT}"
BUNDLE_BASE="${AGENTIC_BUNDLE_BASE}"

# Load .env.development if present (only sets vars not already in env)
if [ -f "${APP_ROOT}/.env.development" ]; then
  while IFS= read -r _line || [ -n "$_line" ]; do
    [[ "$_line" =~ ^[[:space:]]*(#|$) ]] && continue
    _line="${_line#export }"
    _key="${_line%%=*}"
    _key="${_key//[[:space:]]/}"
    [[ -n "$_key" && -z "${!_key+x}" ]] && export "$_line" 2>/dev/null || true
  done < "${APP_ROOT}/.env.development"
  unset _line _key
fi

# Compute bundle IDs from variant
_VARIANT="${APP_VARIANT:-development}"
if [ "$_VARIANT" = "production" ]; then
  SCHEME="${AGENTIC_SCHEME}"
else
  SCHEME="${AGENTIC_SCHEME}-${_VARIANT}"
fi

if [ "$_VARIANT" = "production" ]; then
  BUNDLE_ID_IOS="${BUNDLE_BASE}"
  BUNDLE_ID_ANDROID="${BUNDLE_BASE}"
else
  BUNDLE_ID_IOS="${BUNDLE_BASE}.${_VARIANT}"
  BUNDLE_ID_ANDROID="${BUNDLE_BASE}.${_VARIANT}"
fi

# Expo dev client deep-link schemes are not the same on every platform.
# Android reliably uses the Expo slug-based exp+<slug> scheme from Expo's
# generated manifest, while iOS also registers the variant-specific
# exp+<scheme> alias via withVariantExpoScheme.
DEV_CLIENT_SCHEME_ANDROID="exp+${AGENTIC_SCHEME}"
DEV_CLIENT_SCHEME_IOS="exp+${SCHEME}"

# Default bundle ID (for scripts that use a single BUNDLE_ID)
BUNDLE_ID="${BUNDLE_ID_IOS}"

resolve_agentic_dev_host() {
  if [ -n "${AGENTIC_DEV_HOST:-}" ]; then
    printf '%s\n' "${AGENTIC_DEV_HOST}"
    return 0
  fi

  local lan_ip
  lan_ip=$(ifconfig | awk '/inet / && !/127\./ && !/169\.254\./ {print $2}' | grep -v '^::' | head -1)
  if [ -n "$lan_ip" ]; then
    printf '%s\n' "$lan_ip"
    return 0
  fi

  printf 'localhost\n'
}

# Helpers
info()  { echo "[preflight] $1"; }
pass()  { echo "[preflight] PASS $1"; }
fail()  { echo "[preflight] FAIL $1"; }
