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
HOSTFILE=".agent/metro.host"
TIMEOUT=60

mkdir -p .agent

DEV_HOST="$(resolve_agentic_dev_host)"

print_launch_hint() {
  if [ -n "$DEV_HOST" ]; then
    echo ""
    echo "To open the app on Android:"
    echo "  adb shell am start -a android.intent.action.VIEW -d \"${DEV_CLIENT_SCHEME_ANDROID}://expo-development-client/?url=http://${DEV_HOST}:${PORT}\" ${BUNDLE_ID_ANDROID}/.MainActivity"
    echo ""
  fi
}

# --- Detect a running Metro via HTTP probe ---
if curl -sf "http://localhost:${PORT}/status" >/dev/null 2>&1; then
  # Metro bakes the packager hostname at startup. On physical devices, reusing
  # an old Metro after Wi-Fi/LAN changes can make the app connect to a stale IP
  # even though the localhost health probe passes.
  if [ -f "$HOSTFILE" ]; then
    PREVIOUS_HOST="$(cat "$HOSTFILE" 2>/dev/null || true)"
    if [ -n "$PREVIOUS_HOST" ] && [ "$PREVIOUS_HOST" != "$DEV_HOST" ]; then
      echo "Metro is running on port $PORT for stale host $PREVIOUS_HOST; restarting for $DEV_HOST..."
      PORT_PID=$(lsof -ti:"$PORT" 2>/dev/null || true)
      if [ -n "$PORT_PID" ]; then
        kill "$PORT_PID" 2>/dev/null || true
        sleep 1
        REMAINING=$(lsof -ti:"$PORT" 2>/dev/null || true)
        [ -n "$REMAINING" ] && kill -9 "$REMAINING" 2>/dev/null || true
      fi
      rm -f "$PIDFILE" "$HOSTFILE"
    else
      echo "Metro already running on port $PORT."
      print_launch_hint
      if [ -s "$LOGFILE" ]; then
        echo "Recent logs from $LOGFILE:"
        tail -20 "$LOGFILE"
      fi
      exit 0
    fi
  elif [ -f "$PIDFILE" ] && ! kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
    echo "Metro is running on port $PORT but ${PIDFILE} is stale; restarting so physical-device host metadata is refreshed..."
    PORT_PID=$(lsof -ti:"$PORT" 2>/dev/null || true)
    if [ -n "$PORT_PID" ]; then
      kill "$PORT_PID" 2>/dev/null || true
      sleep 1
      REMAINING=$(lsof -ti:"$PORT" 2>/dev/null || true)
      [ -n "$REMAINING" ] && kill -9 "$REMAINING" 2>/dev/null || true
    fi
    rm -f "$PIDFILE" "$HOSTFILE"
  else
    echo "$DEV_HOST" > "$HOSTFILE"
    echo "Metro already running on port $PORT."
    print_launch_hint
    if [ -s "$LOGFILE" ]; then
      echo "Recent logs from $LOGFILE:"
      tail -20 "$LOGFILE"
    fi
    exit 0
  fi
fi

# A stale Metro may have been stopped above; re-check before starting.
if curl -sf "http://localhost:${PORT}/status" >/dev/null 2>&1; then
  echo "$DEV_HOST" > "$HOSTFILE"
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
    EXPO_USE_METRO_WORKSPACE_ROOT=1 NODE_ENV=development REACT_NATIVE_PACKAGER_HOSTNAME="$4" \
      yarn expo start --dev-client --port "$2" 2>&1 | tee -a "$3"
  ' bash "$APP_ROOT" "$PORT" "$LOGFILE" "$DEV_HOST" >/dev/null 2>&1 &
else
  nohup bash -lc '
    cd "$1"
    EXPO_USE_METRO_WORKSPACE_ROOT=1 NODE_ENV=development REACT_NATIVE_PACKAGER_HOSTNAME="$4" \
      yarn expo start --dev-client --port "$2" >> "$3" 2>&1
  ' bash "$APP_ROOT" "$PORT" "$LOGFILE" "$DEV_HOST" >/dev/null 2>&1 &
fi
METRO_PID=$!
echo "$METRO_PID" > "$PIDFILE"
echo "$DEV_HOST" > "$HOSTFILE"
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
