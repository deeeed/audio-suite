#!/bin/bash
# Start Metro bundler — or attach to an already-running instance.
#
# Behavior:
#   1. Probe http://localhost:$PORT/status to detect a running Metro.
#   2. If running: print a message and exit 0.
#   3. If not running: start Metro in background, log to .agent/metro.log,
#      write PID to .agent/metro.pid, wait for the ready signal.

set -euo pipefail
APP_ROOT="${APP_ROOT:-$(pwd)}"
source "$(cd "$APP_ROOT" && git rev-parse --show-toplevel)/scripts/agentic/_lib.sh"
cd "$APP_ROOT"

LOGFILE=".agent/metro.log"
PIDFILE=".agent/metro.pid"
TIMEOUT=60

mkdir -p .agent

# Detect LAN IP (skip loopback, link-local, VPN)
LAN_IP=$(ifconfig | awk '/inet / && !/127\./ && !/169\.254\./ {print $2}' | grep -v '^::' | head -1)

print_launch_hint() {
  if [ -n "$LAN_IP" ]; then
    echo ""
    echo "To open the app on Android:"
    echo "  adb shell am start -a android.intent.action.VIEW -d \"${DEV_CLIENT_SCHEME_ANDROID}://expo-development-client/?url=http://${LAN_IP}:${PORT}\" ${BUNDLE_ID_ANDROID}/.MainActivity"
    echo ""
  fi
}

# --- Detect a running Metro via HTTP probe ---
if curl -sf "http://localhost:${PORT}/status" >/dev/null 2>&1; then
  echo "Metro already running on port $PORT."
  print_launch_hint
  if [ -s "$LOGFILE" ]; then
    echo "Recent logs from $LOGFILE:"
    tail -20 "$LOGFILE"
  fi
  exit 0
fi

# --- No Metro detected — start fresh ---
> "$LOGFILE"

echo "Starting Metro on port $PORT..."
if [ "$AGENTIC_METRO_LOG_MODE" = "tee" ]; then
  nohup bash -lc '
    cd "$1"
    EXPO_USE_METRO_WORKSPACE_ROOT=1 NODE_ENV=development \
      yarn expo start --dev-client --port "$2" 2>&1 | tee -a "$3"
  ' bash "$APP_ROOT" "$PORT" "$LOGFILE" >/dev/null 2>&1 &
else
  nohup bash -lc '
    cd "$1"
    EXPO_USE_METRO_WORKSPACE_ROOT=1 NODE_ENV=development \
      yarn expo start --dev-client --port "$2" >> "$3" 2>&1
  ' bash "$APP_ROOT" "$PORT" "$LOGFILE" >/dev/null 2>&1 &
fi
METRO_PID=$!
echo "$METRO_PID" > "$PIDFILE"
echo "Metro PID: $METRO_PID, logging to $LOGFILE"

# Wait for ready signal
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  if grep -q "React Native DevTools" "$LOGFILE" 2>/dev/null; then
    echo "Metro ready after ${ELAPSED}s."
    print_launch_hint
    exit 0
  fi
  if grep -q "Logs for your project" "$LOGFILE" 2>/dev/null; then
    echo "Metro ready after ${ELAPSED}s."
    print_launch_hint
    exit 0
  fi
  if ! kill -0 "$METRO_PID" 2>/dev/null; then
    echo "ERROR: Metro exited unexpectedly. Check $LOGFILE"
    rm -f "$PIDFILE"
    exit 1
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

echo "WARNING: Metro did not signal ready within ${TIMEOUT}s (PID $METRO_PID still running)."
echo "Check $LOGFILE for details."
exit 1
