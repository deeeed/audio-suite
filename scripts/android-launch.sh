#!/bin/bash
# ========================================================
# Android Device/Emulator Launch Script
# ========================================================
# Reliably launches an Expo dev client app on a specific
# Android device or emulator by ADB serial.
#
# Usage:
#   ./scripts/android-launch.sh --device "Pixel 6a" --scheme "audioplayground" --port 7365
#   ./scripts/android-launch.sh --select --scheme "sherpa-voice" --port 7500
#   ./scripts/android-launch.sh --device "emulator-5554" --scheme "audioplayground" --port 7365
# ========================================================

set -euo pipefail

DEVICE_NAME="${ANDROID_DEVICE:-}"
APP_SCHEME="${APP_SCHEME:-}"
METRO_PORT="${METRO_PORT:-}"
ANDROID_PACKAGE="${ANDROID_PACKAGE:-}"
ANDROID_ACTIVITY="${ANDROID_ACTIVITY:-.MainActivity}"
DEV_CLIENT_SCHEME="${DEV_CLIENT_SCHEME:-}"
SELECT_MODE=false
SKIP_METRO_CHECK=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[info]${NC} $1"; }
success() { echo -e "${GREEN}[ok]${NC} $1"; }
warn()    { echo -e "${YELLOW}[warn]${NC} $1"; }
error()   { echo -e "${RED}[error]${NC} $1"; }

# Best-effort app-local agentic config lookup so Android launches can use the
# stable Expo slug-based dev-client scheme instead of variant app schemes.
APP_ROOT="${APP_ROOT:-$(pwd)}"
AGENTIC_CONF_FILE="${APP_ROOT}/scripts/agentic/agentic.conf"
if [ -z "$DEV_CLIENT_SCHEME" ] && [ -f "$AGENTIC_CONF_FILE" ]; then
    # shellcheck disable=SC1090
    source "$AGENTIC_CONF_FILE"
    if [ -n "${AGENTIC_SCHEME:-}" ]; then
        DEV_CLIENT_SCHEME="exp+${AGENTIC_SCHEME}"
    fi
fi

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --device|-d)    DEVICE_NAME="$2"; shift 2 ;;
        --scheme)       APP_SCHEME="$2"; shift 2 ;;
        --expo-scheme)  DEV_CLIENT_SCHEME="$2"; shift 2 ;;
        --port|-p)      METRO_PORT="$2"; shift 2 ;;
        --package)      ANDROID_PACKAGE="$2"; shift 2 ;;
        --activity)     ANDROID_ACTIVITY="$2"; shift 2 ;;
        --select)       SELECT_MODE=true; shift ;;
        --skip-metro)   SKIP_METRO_CHECK=true; shift ;;
        *) error "Unknown option: $1"; exit 1 ;;
    esac
done

# ========================================================
# Interactive device selection
# ========================================================
if [ "$SELECT_MODE" = true ] || [ -z "$DEVICE_NAME" ]; then
    DEVICE_LIST=$(adb devices -l 2>/dev/null | grep -v "^List" | grep -v "^$" | while read -r line; do
        serial=$(echo "$line" | awk '{print $1}')
        model=$(echo "$line" | sed -n 's/.*model:\([^ ]*\).*/\1/p')
        transport=$(echo "$line" | sed -n 's/.*transport_id:\([^ ]*\).*/\1/p')
        if [ -n "$model" ]; then
            echo "${model} (${serial})|${serial}"
        else
            echo "${serial}|${serial}"
        fi
    done)

    if [ -z "$DEVICE_LIST" ]; then
        error "No Android devices connected."
        info "Connect a device via USB/WiFi or start an emulator."
        exit 1
    fi

    TOTAL=$(echo "$DEVICE_LIST" | wc -l | tr -d ' ')

    if [ "$TOTAL" -eq 1 ] && [ "$SELECT_MODE" = false ]; then
        # Auto-select if only one device
        DEVICE_NAME=$(echo "$DEVICE_LIST" | cut -d'|' -f2)
        DISPLAY_NAME=$(echo "$DEVICE_LIST" | cut -d'|' -f1)
        success "Auto-selected: $DISPLAY_NAME"
    else
        echo ""
        info "Available Android devices:"
        echo ""
        i=1
        while IFS= read -r line; do
            display=$(echo "$line" | cut -d'|' -f1)
            printf "  ${BLUE}%2d)${NC} %s\n" "$i" "$display"
            i=$((i + 1))
        done <<< "$DEVICE_LIST"
        echo ""

        printf "  Select device [1-${TOTAL}]: "
        read -r SELECTION

        if ! [[ "$SELECTION" =~ ^[0-9]+$ ]] || [ "$SELECTION" -lt 1 ] || [ "$SELECTION" -gt "$TOTAL" ]; then
            error "Invalid selection: $SELECTION"
            exit 1
        fi

        SELECTED_LINE=$(echo "$DEVICE_LIST" | sed -n "${SELECTION}p")
        DEVICE_NAME=$(echo "$SELECTED_LINE" | cut -d'|' -f2)
        success "Selected: $(echo "$SELECTED_LINE" | cut -d'|' -f1)"
    fi
fi

if [ -z "$DEVICE_NAME" ]; then
    error "Device required. Use --device <serial>, --select, or set ANDROID_DEVICE env var."
    exit 1
fi

if [ -z "$APP_SCHEME" ]; then
    error "App scheme required. Use --scheme <scheme> or set APP_SCHEME env var."
    exit 1
fi

if [ -z "$DEV_CLIENT_SCHEME" ]; then
    DEV_CLIENT_SCHEME="exp+${APP_SCHEME}"
fi

if [ -z "$METRO_PORT" ]; then
    error "Metro port required. Use --port <port> or set METRO_PORT env var."
    exit 1
fi

info "Using device: $DEVICE_NAME"

# ========================================================
# Setup ADB reverse port forwarding
# ========================================================
info "Setting up ADB reverse port forwarding (port $METRO_PORT)"
adb -s "$DEVICE_NAME" reverse tcp:"$METRO_PORT" tcp:"$METRO_PORT" 2>/dev/null || warn "ADB reverse failed (device may not support it)"

# ========================================================
# Check Metro is running
# ========================================================
if [ "$SKIP_METRO_CHECK" = false ]; then
    if curl -s "http://localhost:${METRO_PORT}/status" 2>/dev/null | grep -q "packager-status:running"; then
        success "Metro running on port $METRO_PORT"
    else
        warn "Metro not detected on port $METRO_PORT"
        warn "Start it with: yarn expo start --port $METRO_PORT --dev-client"
    fi
fi

# ========================================================
# Send deep link
# ========================================================
DEEP_LINK="${DEV_CLIENT_SCHEME}://expo-development-client/?url=http%3A%2F%2Flocalhost%3A${METRO_PORT}"

info "Sending deep link to $DEVICE_NAME"
info "  -> $DEEP_LINK"

if [ -n "$ANDROID_PACKAGE" ]; then
    COMPONENT="$ANDROID_PACKAGE/$ANDROID_ACTIVITY"
    info "Using explicit component: $COMPONENT"
    adb -s "$DEVICE_NAME" shell am start -a android.intent.action.VIEW -n "$COMPONENT" -d "$DEEP_LINK" 2>/dev/null
else
    adb -s "$DEVICE_NAME" shell am start -a android.intent.action.VIEW -d "$DEEP_LINK" 2>/dev/null
fi

success "Launched $APP_SCHEME on $DEVICE_NAME"
echo ""
info "Summary:"
echo "  Device:  $DEVICE_NAME"
echo "  Scheme:  $APP_SCHEME"
echo "  Dev URL: ${DEV_CLIENT_SCHEME}"
echo "  Metro:   http://localhost:$METRO_PORT"
if [ -n "$ANDROID_PACKAGE" ]; then
    echo "  Package: $ANDROID_PACKAGE"
fi
