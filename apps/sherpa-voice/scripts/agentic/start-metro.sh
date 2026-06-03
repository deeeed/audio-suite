#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
APP_ROOT="$(pwd)"
export EXPO_PUBLIC_FARMSLOT_RECIPE_BRIDGE="${EXPO_PUBLIC_FARMSLOT_RECIPE_BRIDGE:-1}"
exec bash "$(git rev-parse --show-toplevel)/scripts/agentic/start-metro.sh" "$@"
