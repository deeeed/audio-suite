#!/bin/bash
# preflight.sh — Full environment setup for an audiolab app.
# Boots device, starts Metro, builds + installs app if needed, launches app.
#
# Must work non-interactively (called by automation that captures output).
#
# Reads all app-specific config from agentic.conf via _lib.sh.
#
# Environment:
#   PLATFORM         ios | android (default: ios)
#   WATCHER_PORT     Metro port (overrides agentic.conf)
#   IOS_SIMULATOR    Simulator name (iOS only)
#   ADB_SERIAL       Emulator serial (Android only)

set -euo pipefail
APP_ROOT="${APP_ROOT:-$(pwd)}"
source "$(cd "$APP_ROOT" && git rev-parse --show-toplevel)/scripts/agentic/_lib.sh"
cd "$APP_ROOT"

PLATFORM="${PLATFORM:-ios}"
APP_VARIANT_EFFECTIVE="${APP_VARIANT:-development}"

run_simctl_timeout() {
  python3 - "$@" <<'PY'
import subprocess
import sys

cmd = ["xcrun", "simctl", *sys.argv[1:]]
try:
    completed = subprocess.run(cmd, check=False, timeout=15)
except subprocess.TimeoutExpired:
    sys.exit(124)
sys.exit(completed.returncode)
PY
}

simulator_app_installed() {
  local sim_uuid="$1"
  local bundle_id="$2"
  if run_simctl_timeout get_app_container "$sim_uuid" "$bundle_id" app >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

resolve_ios_workspace_and_scheme() {
  local variant="$1"
  local workspace_basename="AudioPlayground"

  if [ "$variant" != "production" ]; then
    workspace_basename="AudioDevPlayground"
  fi

  local workspace_path="ios/${workspace_basename}.xcworkspace"
  local project_path="ios/${workspace_basename}.xcodeproj"

  if [ ! -d "$workspace_path" ] || [ ! -d "$project_path" ]; then
    local setup_script="${APP_ROOT}/scripts/setup-env.sh"
    if [ -x "$setup_script" ]; then
      info "Preparing iOS prebuild for variant ${variant}..."
      (cd "$APP_ROOT" && "$setup_script" "$variant" force)
    else
      fail "Missing iOS workspace for variant ${variant}: ${workspace_path}"
      fail "Run APP_VARIANT=${variant} yarn expo prebuild --clean"
      exit 1
    fi
  fi

  IOS_WORKSPACE_PATH="$workspace_path"
  IOS_SCHEME_NAME="$workspace_basename"
}

ensure_ios_simulator_exists() {
  local sim_name="$1"

  if xcrun simctl list devices 2>/dev/null | grep -q "${sim_name}"; then
    return 0
  fi

  info "Simulator '${sim_name}' not found — creating a fresh iOS simulator..."

  local runtime_id
  runtime_id=$(xcrun simctl list runtimes -j | python3 -c "
import json, sys
runtimes = json.load(sys.stdin).get('runtimes', [])
ios = [r for r in runtimes if r.get('isAvailable') and r.get('platform') == 'iOS']
ios.sort(key=lambda r: r.get('version', ''))
if not ios:
    sys.exit(1)
print(ios[-1]['identifier'])
" 2>/dev/null || true)

  if [ -z "${runtime_id:-}" ]; then
    fail "Could not determine an available iOS runtime for simulator creation"
    exit 1
  fi

  local device_type="com.apple.CoreSimulator.SimDeviceType.iPhone-16"
  if ! xcrun simctl list devicetypes 2>/dev/null | grep -q "${device_type}"; then
    device_type="com.apple.CoreSimulator.SimDeviceType.iPhone-15"
  fi

  if ! xcrun simctl create "${sim_name}" "${device_type}" "${runtime_id}" >/dev/null 2>&1; then
    fail "Failed to create simulator '${sim_name}'"
    exit 1
  fi

  pass "Created simulator ${sim_name}"
}

# ── 1. Boot device ──────────────────────────────────────────────
info "Step 1: Boot device (${PLATFORM})"
if [ "$PLATFORM" = "ios" ]; then
  # Determine device mode:
  #   - IOS_SIMULATOR explicitly empty (ios:device sets IOS_SIMULATOR=) → physical device preferred
  #   - IOS_SIMULATOR unset or non-empty → use simulator
  USE_IOS_PHYSICAL=false
  if [ "${IOS_SIMULATOR+set}" = "set" ] && [ -z "${IOS_SIMULATOR}" ]; then
    USE_IOS_PHYSICAL=true
  fi

  if [ "$USE_IOS_PHYSICAL" = true ]; then
    # Auto-detect connected physical iOS device via xcrun devicectl
    IOS_PHYSICAL_UDID=""
    IOS_PHYSICAL_NAME=""
    if command -v xcrun &>/dev/null; then
      # Parse devicectl verbose output for the real UDID (not CoreDevice identifier)
      IOS_PHYSICAL_INFO=$(xcrun devicectl list devices -v 2>/dev/null | python3 -c "
import sys, re
text = sys.stdin.read()
blocks = re.split(r'(?=▿ .+ - [0-9A-F]{8}-)', text)
for block in blocks:
    if 'available' not in block and 'paired' not in block:
        continue
    if 'physical' not in block:
        continue
    udid_match = re.search(r'udid: Optional\(\"([^\"]+)\"\)', block)
    name_match = re.search(r'marketingName: Optional\(\"([^\"]+)\"\)', block)
    if udid_match:
        name = name_match.group(1) if name_match else 'unknown'
        print(f'{udid_match.group(1)}|{name}')
        break
" 2>/dev/null || true)
      if [ -n "$IOS_PHYSICAL_INFO" ]; then
        IOS_PHYSICAL_UDID="${IOS_PHYSICAL_INFO%%|*}"
        IOS_PHYSICAL_NAME="${IOS_PHYSICAL_INFO##*|}"
      fi
    fi

    if [ -n "$IOS_PHYSICAL_UDID" ]; then
      IOS_DEVICE_UDID="$IOS_PHYSICAL_UDID"
      IOS_DEVICE_MODE="physical"
      pass "Physical iOS device detected: ${IOS_PHYSICAL_NAME} (${IOS_DEVICE_UDID})"
    else
      if [ "$AGENTIC_IOS_PHYSICAL_FALLBACK" = "simulator" ]; then
        info "No physical iOS device found — falling back to simulator"
        USE_IOS_PHYSICAL=false
        SIM="${IOS_SIMULATOR:-${AGENTIC_DEFAULT_SIMULATOR}}"
      else
        fail "No physical iOS device found — connect a device via USB"
        exit 1
      fi
    fi
  fi

  if [ "$USE_IOS_PHYSICAL" = false ]; then
    SIM="${IOS_SIMULATOR:-${AGENTIC_DEFAULT_SIMULATOR}}"
    IOS_DEVICE_MODE="simulator"
    ensure_ios_simulator_exists "${SIM}"
    if xcrun simctl list devices booted 2>/dev/null | grep -q "${SIM}"; then
      pass "Simulator ${SIM} already booted"
    else
      xcrun simctl boot "${SIM}" 2>/dev/null || true
      sleep 2
      pass "Simulator ${SIM} booted"
    fi

    SIM_UUID=$(xcrun simctl list devices -j | python3 -c "
import json,sys
data=json.load(sys.stdin)
for runtime,devs in data['devices'].items():
  for d in devs:
    if d['name']=='${SIM}' and d['isAvailable']:
      print(d['udid']); sys.exit(0)
sys.exit(1)
" 2>/dev/null || true)
    if [ -z "${SIM_UUID:-}" ]; then
      fail "Could not resolve simulator UUID for ${SIM}"
      exit 1
    fi
  fi
elif [ "$PLATFORM" = "android" ]; then
  # Determine device mode:
  #   - If ANDROID_DEVICE is set and non-empty → emulator AVD name
  #   - If ANDROID_DEVICE is unset → default emulator
  #   - If ANDROID_DEVICE is explicitly empty → physical device
  USE_PHYSICAL=false
  if [ "${ANDROID_DEVICE+set}" = "set" ] && [ -z "${ANDROID_DEVICE}" ]; then
    USE_PHYSICAL=true
  fi

  if [ "$USE_PHYSICAL" = true ]; then
    SERIAL=$(adb devices 2>/dev/null | grep -E '^\S+\s+device$' | grep -v '^emulator-' | grep -v ':[0-9]*\s' | head -1 | awk '{print $1}')
    if [ -z "$SERIAL" ]; then
      info "No physical Android device found — falling back to emulator"
      USE_PHYSICAL=false
    else
      pass "Physical device detected: ${SERIAL}"
    fi
  fi

  if [ "$USE_PHYSICAL" = true ]; then
    adb -s "${SERIAL}" reverse --remove-all 2>/dev/null || true
    adb -s "${SERIAL}" reverse tcp:"${PORT}" tcp:"${PORT}" 2>/dev/null || true
    adb -s "${SERIAL}" reverse tcp:8081 tcp:"${PORT}" 2>/dev/null || true
  elif [ "$AGENTIC_ANDROID_EMULATOR_AUTOBOOT" = "true" ]; then
    SERIAL="${ADB_SERIAL:-${AGENTIC_DEFAULT_EMULATOR_SERIAL}}"
    AVD="${ANDROID_DEVICE:-${AGENTIC_DEFAULT_AVD}}"
    EMU_PORT="${EMULATOR_PORT:-${SERIAL#emulator-}}"
    WINDOW_FLAG=""
    [ "${HEADLESS:-1}" = "1" ] && WINDOW_FLAG="-no-window"

    if adb devices 2>/dev/null | grep -q "${SERIAL}"; then
      EMULATOR_HAS_WINDOW=0
      if [ "${HEADLESS:-1}" = "0" ] && [ "$EMULATOR_HAS_WINDOW" = "0" ]; then
        info "Emulator ${SERIAL} is headless — restarting with window..."
        adb -s "${SERIAL}" emu kill 2>/dev/null || true
        sleep 2
        emulator -avd "$AVD" -port "$EMU_PORT" -no-snapshot-load &>/dev/null &
        adb -s "${SERIAL}" wait-for-device
        until adb -s "${SERIAL}" shell getprop sys.boot_completed 2>/dev/null | grep -q "1"; do sleep 2; done
        pass "Emulator ${AVD} restarted with window"
      else
        pass "Emulator ${SERIAL} already running"
      fi
    else
      info "Emulator ${SERIAL} not found — booting ${AVD}..."
      emulator -avd "$AVD" -port "$EMU_PORT" $WINDOW_FLAG -no-snapshot-load &>/dev/null &
      sleep 5
      adb -s "${SERIAL}" wait-for-device
      SERIAL="emulator-${EMU_PORT}"
      until adb -s "${SERIAL}" shell getprop sys.boot_completed 2>/dev/null | grep -q "1"; do sleep 2; done
      pass "Emulator ${AVD} booted on ${SERIAL}"
    fi
    adb -s "${SERIAL}" reverse --remove-all 2>/dev/null || true
    adb -s "${SERIAL}" reverse tcp:"${PORT}" tcp:"${PORT}" 2>/dev/null || true
    adb -s "${SERIAL}" reverse tcp:8081 tcp:"${PORT}" 2>/dev/null || true
  else
    SERIAL="${ADB_SERIAL:-${AGENTIC_DEFAULT_EMULATOR_SERIAL}}"
    if adb devices 2>/dev/null | grep -q "${SERIAL}"; then
      pass "Emulator ${SERIAL} already running"
    else
      info "Emulator ${SERIAL} not found — start it manually or via setup script"
      fail "Emulator ${SERIAL} not running"
      exit 1
    fi
    adb -s "${SERIAL}" reverse --remove-all 2>/dev/null || true
    adb -s "${SERIAL}" reverse tcp:"${PORT}" tcp:"${PORT}" 2>/dev/null || true
    adb -s "${SERIAL}" reverse tcp:8081 tcp:"${PORT}" 2>/dev/null || true
  fi
fi

# ── 2. Start Metro ─────────────────────────────────────────────
info "Step 2: Start Metro on port ${PORT}"
MONOREPO_ROOT="$(cd "$APP_ROOT" && git rev-parse --show-toplevel)"
APP_ROOT="$APP_ROOT" WATCHER_PORT="${PORT}" bash "${MONOREPO_ROOT}/scripts/agentic/start-metro.sh"

# ── 3. Build + install app if needed ───────────────────────────
info "Step 3: Check if app is installed"
APP_INSTALLED=false

if [[ "${SKIP_BUILD:-0}" == "1" ]] && [[ "$AGENTIC_SKIP_BUILD_SUPPORTED" == "true" ]]; then
  if [[ "$PLATFORM" == "ios" ]] && [[ "${IOS_DEVICE_MODE:-simulator}" == "physical" ]]; then
    if xcrun devicectl device info apps --device "${IOS_DEVICE_UDID}" 2>/dev/null | grep -q "${BUNDLE_ID_IOS}"; then
      APP_INSTALLED=true
      pass "App ${BUNDLE_ID_IOS} already installed on physical device ${IOS_DEVICE_UDID}"
    fi
  elif [[ "$PLATFORM" == "ios" ]]; then
    if simulator_app_installed "${SIM_UUID}" "${BUNDLE_ID_IOS}"; then
      APP_INSTALLED=true
      pass "App ${BUNDLE_ID_IOS} already installed on ${SIM}"
    else
      fail "App ${BUNDLE_ID_IOS} is not installed on ${SIM}. Re-run without SKIP_BUILD=1 for the first install."
      exit 1
    fi
  elif [[ "$PLATFORM" == "android" ]]; then
    if adb -s "${SERIAL}" shell pm list packages 2>/dev/null | grep -q "${BUNDLE_ID_ANDROID}"; then
      APP_INSTALLED=true
      pass "App ${BUNDLE_ID_ANDROID} already installed on ${SERIAL}"
    fi
  fi
elif [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  # Check if already installed (for non-skip-build apps)
  if [ "$PLATFORM" = "ios" ] && [ "${IOS_DEVICE_MODE:-simulator}" = "simulator" ]; then
    info "Skipping iOS simulator install probe on ${SIM}; rebuilding/installing is more reliable than simctl listapps on this CoreSimulator runtime"
  elif [ "$PLATFORM" = "android" ]; then
    if adb -s "${SERIAL}" shell pm list packages 2>/dev/null | grep -q "${BUNDLE_ID_ANDROID}"; then
      APP_INSTALLED=true
      pass "App ${BUNDLE_ID_ANDROID} already installed on ${SERIAL}"
    fi
  fi
fi

# REBUILD=1 forces reinstall even if app is already installed
if [ "${REBUILD:-0}" = "1" ]; then APP_INSTALLED=false; fi

if [ "$APP_INSTALLED" = false ]; then
  info "App not installed — building..."

  # Run pre-build hook if defined
  if [ -n "${AGENTIC_PRE_BUILD_HOOK:-}" ]; then
    info "Running pre-build hook: ${AGENTIC_PRE_BUILD_HOOK}"
    eval "$AGENTIC_PRE_BUILD_HOOK"
  fi

  if [ "$PLATFORM" = "ios" ] && [ "${IOS_DEVICE_MODE:-simulator}" = "physical" ]; then
    resolve_ios_workspace_and_scheme "$APP_VARIANT_EFFECTIVE"
    info "Building iOS app for physical device ${IOS_DEVICE_UDID} using ${IOS_SCHEME_NAME}..."
    xcodebuild -workspace "$IOS_WORKSPACE_PATH" -scheme "$IOS_SCHEME_NAME" \
      -destination "id=${IOS_DEVICE_UDID}" \
      -configuration Debug \
      -derivedDataPath ios/build-device \
      -allowProvisioningUpdates \
      build 2>&1 | tail -5
    APP_PATH="ios/build-device/Build/Products/Debug-iphoneos/${IOS_SCHEME_NAME}.app"
    if [ ! -d "$APP_PATH" ]; then
      fail "Built .app not found at $APP_PATH"
      exit 1
    fi
    xcrun devicectl device install app --device "${IOS_DEVICE_UDID}" "$APP_PATH"
    pass "iOS app built and installed on physical device"
  elif [ "$PLATFORM" = "ios" ]; then
    resolve_ios_workspace_and_scheme "$APP_VARIANT_EFFECTIVE"
    info "Building iOS app for simulator ${SIM} (${SIM_UUID}) using ${IOS_SCHEME_NAME}..."
    xcodebuild -workspace "$IOS_WORKSPACE_PATH" -scheme "$IOS_SCHEME_NAME" \
      -destination "platform=iOS Simulator,id=${SIM_UUID}" \
      -configuration Debug \
      -derivedDataPath ios/build \
      build 2>&1 | tail -5
    APP_PATH="ios/build/Build/Products/Debug-iphonesimulator/${IOS_SCHEME_NAME}.app"
    if [ ! -d "$APP_PATH" ]; then
      fail "Built .app not found at $APP_PATH"
      exit 1
    fi
    xcrun simctl install "${SIM_UUID}" "$APP_PATH"
    pass "iOS app built and installed on ${SIM}"
  elif [ "$PLATFORM" = "android" ]; then
    info "Building Android app for ${SERIAL}..."
    cd android && ./gradlew :app:assembleDebug && cd ..
    APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"
    if [ ! -f "$APK_PATH" ]; then
      fail "APK not found at $APK_PATH"
      exit 1
    fi
    adb -s "${SERIAL}" install -r "$APK_PATH"
    pass "Android app built and installed on ${SERIAL}"
  fi
fi

# ── 4. Launch via Expo dev client deep link ────────────────────
info "Step 4: Launch app on correct port (${PORT})"

# Determine Metro host
if [ "$PLATFORM" = "ios" ] && [ "${IOS_DEVICE_MODE:-simulator}" = "simulator" ]; then
  METRO_HOST="localhost"
elif [ "$PLATFORM" = "ios" ] && [ "${IOS_DEVICE_MODE:-simulator}" = "physical" ]; then
  METRO_HOST=$(ipconfig getifaddr en0 2>/dev/null || echo localhost)
elif [[ "${SERIAL:-}" == emulator-* ]]; then
  METRO_HOST="10.0.2.2"
elif [ "$PLATFORM" = "android" ]; then
  METRO_HOST="localhost"
else
  METRO_HOST=$(ipconfig getifaddr en0 2>/dev/null || echo localhost)
fi
ENCODED_URL=$(python3 -c "import urllib.parse; print(urllib.parse.quote('http://${METRO_HOST}:${PORT}', safe=''))")
if [ "$PLATFORM" = "android" ]; then
  DEV_CLIENT_SCHEME="${DEV_CLIENT_SCHEME_ANDROID}"
else
  DEV_CLIENT_SCHEME="${DEV_CLIENT_SCHEME_IOS}"
fi
DEV_CLIENT_URL="${DEV_CLIENT_SCHEME}://expo-development-client/?url=${ENCODED_URL}"

if [ "$PLATFORM" = "ios" ] && [ "${IOS_DEVICE_MODE:-simulator}" = "physical" ]; then
  xcrun devicectl device process launch \
    --timeout 30 \
    --device "${IOS_DEVICE_UDID}" \
    --terminate-existing \
    --payload-url "${DEV_CLIENT_URL}" \
    "${BUNDLE_ID_IOS}" 2>/dev/null || true

  sleep 5
  xcrun devicectl device process launch \
    --timeout 30 \
    --device "${IOS_DEVICE_UDID}" \
    --payload-url "${DEV_CLIENT_URL}" \
    "${BUNDLE_ID_IOS}" 2>/dev/null || true
  pass "App launched on physical device ${IOS_DEVICE_UDID} → ${METRO_HOST}:${PORT}"

elif [ "$PLATFORM" = "ios" ]; then
  xcrun simctl spawn "${SIM_UUID}" defaults write "${BUNDLE_ID_IOS}" EXDevMenuIsOnboardingFinished -bool YES 2>/dev/null || true
  xcrun simctl spawn "${SIM_UUID}" defaults write "${BUNDLE_ID_IOS}" EXDevMenuDisableAutoLaunch -bool YES 2>/dev/null || true

  run_simctl_timeout terminate "${SIM_UUID}" "${BUNDLE_ID_IOS}" 2>/dev/null || true
  sleep 1
  run_simctl_timeout openurl "${SIM_UUID}" "${DEV_CLIENT_URL}" 2>/dev/null || true

  sleep 5
  if ! xcrun simctl spawn "${SIM_UUID}" launchctl list 2>/dev/null | grep -q "${BUNDLE_ID_IOS}"; then
    info "App exited after launch — retrying..."
    sleep 2
    run_simctl_timeout openurl "${SIM_UUID}" "${DEV_CLIENT_URL}" 2>/dev/null || true
  fi
  pass "App launched on ${SIM} → localhost:${PORT}"

elif [ "$PLATFORM" = "android" ]; then
  PREFS_DIR="/data/data/${BUNDLE_ID_ANDROID}/shared_prefs"
  PREFS_FILE="expo.modules.devmenu.sharedpreferences.xml"
  adb -s "${SERIAL}" shell "mkdir -p ${PREFS_DIR} && echo '<?xml version=\"1.0\" encoding=\"utf-8\" standalone=\"yes\" ?><map><boolean name=\"isOnboardingFinished\" value=\"true\" /></map>' > ${PREFS_DIR}/${PREFS_FILE}" 2>/dev/null || true

  adb -s "${SERIAL}" shell am force-stop "${BUNDLE_ID_ANDROID}" 2>/dev/null || true
  sleep 1
  adb -s "${SERIAL}" shell am start -a android.intent.action.VIEW -d "${DEV_CLIENT_URL}" 2>/dev/null || true

  sleep 5
  if ! adb -s "${SERIAL}" shell pidof "${BUNDLE_ID_ANDROID}" >/dev/null 2>&1; then
    info "App exited after launch — retrying..."
    sleep 2
    adb -s "${SERIAL}" shell am start -a android.intent.action.VIEW -d "${DEV_CLIENT_URL}" 2>/dev/null || true
  fi
  pass "App launched on ${SERIAL} → localhost:${PORT}"
fi

# ── 5. Wait for CDP / health ──────────────────────────────────
info "Step 5: Wait for app health (CDP)"
HEALTH_TIMEOUT=90
ELAPSED=0
while [ $ELAPSED -lt $HEALTH_TIMEOUT ]; do
  HEALTH=$(WATCHER_PORT="${PORT}" node "${APP_ROOT}/scripts/agentic/cdp-bridge.mjs" get-route 2>/dev/null || true)
  if [ -n "$HEALTH" ] && echo "$HEALTH" | grep -q '"pathname"'; then
    pass "App responding via CDP after ${ELAPSED}s"
    echo "$HEALTH"
    exit 0
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done

info "App did not respond via CDP within ${HEALTH_TIMEOUT}s — Metro is running, app may need manual interaction"
exit 0
