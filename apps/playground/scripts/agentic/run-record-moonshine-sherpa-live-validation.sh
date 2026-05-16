#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/../.."

DEVICE_NAME="${DEVICE_NAME:-Pixel 6a}"
ADB_SERIAL="${ADB_SERIAL:-29071JEGR20638}"
SAY_VOICE_1="${SAY_VOICE_1:-Daniel}"
SAY_VOICE_2="${SAY_VOICE_2:-Karen}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-.agent/artifacts/record-moonshine-sherpa-live-${TIMESTAMP}}"
RECIPE="scripts/agentic/teams/playground/recipes/record-moonshine-sherpa-live-validation.json"
BRIDGE="scripts/agentic/cdp-bridge.mjs"

if ! command -v say >/dev/null 2>&1; then
  echo "ERROR: macOS 'say' command is required for controlled local speech." >&2
  exit 1
fi

voice_available() {
  local voice="$1"
  say -v '?' | awk '{print $1}' | grep -Fxq "$voice"
}

if ! voice_available "$SAY_VOICE_1"; then
  echo "ERROR: SAY_VOICE_1='$SAY_VOICE_1' is not available. Run: say -v '?'" >&2
  exit 1
fi
if ! voice_available "$SAY_VOICE_2"; then
  echo "ERROR: SAY_VOICE_2='$SAY_VOICE_2' is not available. Run: say -v '?'" >&2
  exit 1
fi
if [ "$SAY_VOICE_1" = "$SAY_VOICE_2" ]; then
  echo "ERROR: SAY_VOICE_1 and SAY_VOICE_2 must be different for speaker-turn validation." >&2
  exit 1
fi

cleanup() {
  if [ -n "${SPEECH_WATCHER_PID:-}" ]; then
    pkill -P "${SPEECH_WATCHER_PID}" 2>/dev/null || true
    kill "${SPEECH_WATCHER_PID}" 2>/dev/null || true
    wait "${SPEECH_WATCHER_PID}" 2>/dev/null || true
  fi
  pkill -P $$ 2>/dev/null || true
}
trap cleanup EXIT



state_ready_for_speech() {
  node "$BRIDGE" --device "$DEVICE_NAME" eval "JSON.stringify(globalThis.__AGENTIC__?.getPageState?.() || null)" 2>/dev/null \
    | python3 -c '
import json, sys
raw = sys.stdin.read().strip()
try:
    value = json.loads(raw)
    if isinstance(value, str):
        value = json.loads(value)
except Exception:
    sys.exit(1)
ready = (
    value.get("route") == "/record" and
    value.get("enableMoonshineSherpaLive") is True and
    value.get("isMoonshineSherpaRecording") is True and
    value.get("moonshineSherpaSherpaReady") is True and
    value.get("moonshineSherpaError") is None
)
print("1" if ready else "0")
' 2>/dev/null | tail -1
}


(
  echo "[speech] Waiting for Record tab Moonshine + Sherpa pipeline readiness..."
  for _ in $(seq 1 240); do
    if [ "$(state_ready_for_speech || echo 0)" = "1" ]; then
      echo "[speech] Pipeline ready; starting controlled speech with voices '$SAY_VOICE_1' and '$SAY_VOICE_2'."
      for i in $(seq 1 2); do
        say -v "$SAY_VOICE_1" -r 175 "Speaker one validates the main record tab moonshine sherpa live mode round $i. Audio chunks should produce transcription and speaker turn metrics." || true
        sleep 0.5
        say -v "$SAY_VOICE_2" -r 175 "Speaker two answers from the same record screen with attributed transcript validation round $i." || true
        sleep 1
      done
      echo "[speech] Controlled speech completed."
      exit 0
    fi
    sleep 1
  done
  echo "[speech] Timed out waiting for live pipeline readiness." >&2
  exit 1
) &
SPEECH_WATCHER_PID=$!

ADB_SERIAL="$ADB_SERIAL" yarn recipe:run "$RECIPE" --device "$DEVICE_NAME" --artifacts-dir "$ARTIFACTS_DIR"
STATUS=$?
cleanup
trap - EXIT
exit "$STATUS"
