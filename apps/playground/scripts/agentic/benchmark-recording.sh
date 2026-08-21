#!/usr/bin/env bash
# benchmark-recording.sh — Automated recording performance benchmark
#
# Usage:
#   benchmark-recording.sh [--duration <seconds>] [--label <name>] [--config <json>] [--interval <seconds>] [--device <name>]
#
# Measures CPU, Java Heap, Native Heap, and Total PSS at regular intervals
# during a recording session. Outputs [BENCH] lines and a final [BENCH-SUMMARY].

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_PKG="net.siteed.audioplayground.development"

# Defaults
DURATION=600
LABEL="benchmark"
CONFIG='{"enableProcessing": false}'
INTERVAL=30
# Bash 3.2 (macOS /bin/bash) errors on "${empty[@]}" under `set -u`, so keep a
# placeholder element and expand from index 1.
DEVICE_ARGS=("")
DEVICE_NAME=""
POST_START_EVAL=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --duration) DURATION="$2"; shift 2 ;;
        --label) LABEL="$2"; shift 2 ;;
        --config) CONFIG="$2"; shift 2 ;;
        --interval) INTERVAL="$2"; shift 2 ;;
        --device) DEVICE_NAME="$2"; DEVICE_ARGS=("" --device "$2"); shift 2 ;;
        --post-start-eval) POST_START_EVAL="$2"; shift 2 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# Helper: run adb (with optional device filter)
resolve_serial() {
    if [[ -n "$DEVICE_NAME" ]]; then
        local dev_name="$DEVICE_NAME"
        local serial
        serial=$(adb devices -l | grep -i "$dev_name" | awk '{print $1}' | head -1)
        if [[ -n "$serial" ]]; then
            echo "$serial"
            return
        fi
        echo "[BENCH] WARNING: device '$dev_name' not found, falling back to USB device" >&2
    fi
    # Prefer USB-connected device over WiFi
    local serial
    serial=$(adb devices -l | grep -E "usb:" | awk '{print $1}' | head -1)
    if [[ -z "$serial" ]]; then
        serial=$(adb devices | grep -v "^List" | grep -v "^$" | head -1 | awk '{print $1}')
    fi
    echo "$serial"
}

ADB_SERIAL=""
run_adb() {
    if [[ -z "$ADB_SERIAL" ]]; then
        ADB_SERIAL=$(resolve_serial)
        echo "[BENCH] Using device serial: $ADB_SERIAL" >&2
    fi
    adb -s "$ADB_SERIAL" "$@"
}

# Helper: get memory stats — returns "java_heap native_heap total_pss" in KB
get_memory() {
    local meminfo
    meminfo=$(run_adb shell dumpsys meminfo "$APP_PKG" 2>/dev/null)
    local java_heap native_heap total_pss

    java_heap=$(echo "$meminfo" | grep -E "Java Heap:" | awk '{print $3}' | head -1)
    native_heap=$(echo "$meminfo" | grep -E "Native Heap:" | awk '{print $3}' | head -1)
    total_pss=$(echo "$meminfo" | grep -E "TOTAL PSS:" | awk '{print $3}' | head -1)

    # Fallback: try alternate format
    if [[ -z "$total_pss" ]]; then
        total_pss=$(echo "$meminfo" | grep -E "^\s+TOTAL\s" | awk '{print $2}' | head -1)
    fi
    if [[ -z "$java_heap" ]]; then
        java_heap=$(echo "$meminfo" | grep -E "Java Heap:" | head -1 | grep -oE '[0-9]+' | head -1)
    fi
    if [[ -z "$native_heap" ]]; then
        native_heap=$(echo "$meminfo" | grep -E "Native Heap:" | head -1 | grep -oE '[0-9]+' | head -1)
    fi

    echo "${java_heap:-0} ${native_heap:-0} ${total_pss:-0}"
}

# Helper: get CPU % for the app
get_cpu() {
    local cpu
    cpu=$(run_adb shell top -b -n 1 -q 2>/dev/null | grep "$APP_PKG" | head -1 | awk '{print $9}')
    echo "${cpu:-0}"
}

# Convert KB to MB (integer)
kb_to_mb() {
    echo $(( ${1:-0} / 1024 ))
}

# Poll the stored fire-and-store outcome. Without this the benchmark reports a summary
# even when startRecording/stopRecording failed outright.
await_bench() {
    local what="$1" tries=0 raw
    while (( tries < 20 )); do
        raw=$("$SCRIPT_DIR/app-state.sh" eval "JSON.stringify(globalThis.__BENCH || null)" "${DEVICE_ARGS[@]:1}" 2>/dev/null | tr -d '\n' || true)
        if echo "$raw" | grep -q '"err"'; then
            echo "[BENCH] FATAL: $what failed: $raw" >&2
            exit 1
        fi
        if echo "$raw" | grep -qE '"(started|uri|size)"'; then
            echo "[BENCH] $what ok: $raw"
            return 0
        fi
        sleep 1
        tries=$(( tries + 1 ))
    done
    echo "[BENCH] FATAL: $what produced no result within 20s (last: ${raw:-<none>})" >&2
    exit 1
}

# ── Check for skipRecording mode ──
SKIP_RECORDING=false
if echo "$CONFIG" | grep -qE '"skipRecording"\s*:\s*true'; then
    SKIP_RECORDING=true
fi

# ── Navigate to record screen ──
echo "[BENCH] Navigating to record screen..."
"$SCRIPT_DIR/app-navigate.sh" "/(tabs)/record" "${DEVICE_ARGS[@]:1}" 2>/dev/null || true
sleep 2

# ── Baseline memory ──
read -r java0 native0 pss0 <<< "$(get_memory)"
cpu0=$(get_cpu)
echo "[BENCH] label=$LABEL, t=0s, cpu=${cpu0}%, java_heap=$(kb_to_mb $java0)MB, native_heap=$(kb_to_mb $native0)MB, total_pss=$(kb_to_mb $pss0)MB"

# ── Start recording (unless skipped) ──
if [[ "$SKIP_RECORDING" == "true" ]]; then
    echo "[BENCH] Skipping recording (idle baseline mode)"
else
    echo "[BENCH] Starting recording with config: $CONFIG"
    # Fire-and-store: an eval held open while audio starts flowing crashes the app
    # (#436). Schedule the call so the eval returns before the first buffer lands.
    "$SCRIPT_DIR/app-state.sh" eval "(() => { globalThis.__BENCH = null; setTimeout(async () => { try { const r = await __AGENTIC__.startRecording($CONFIG); globalThis.__BENCH = (r && r.error) ? { err: String(r.error) } : { started: true } } catch (e) { globalThis.__BENCH = { err: String(e) } } }, 500); return 'scheduled' })()" "${DEVICE_ARGS[@]:1}" 2>/dev/null || true
    await_bench "startRecording"
    if [[ -n "$POST_START_EVAL" ]]; then
        echo "[BENCH] Running post-start eval: $POST_START_EVAL"
        "$SCRIPT_DIR/app-state.sh" eval "$POST_START_EVAL" "${DEVICE_ARGS[@]:1}" 2>/dev/null || true
        sleep 1
    fi
fi

# ── Collect metrics ──
declare -a cpu_samples=()
declare -a pss_samples=()
elapsed=0

# First sample after recording starts
read -r java native pss <<< "$(get_memory)"
cpu=$(get_cpu)
echo "[BENCH] label=$LABEL, t=${elapsed}s (recording), cpu=${cpu}%, java_heap=$(kb_to_mb $java)MB, native_heap=$(kb_to_mb $native)MB, total_pss=$(kb_to_mb $pss)MB"
cpu_samples+=("$cpu")
pss_samples+=("$pss")
pss_start="$pss"

while (( elapsed < DURATION )); do
    sleep "$INTERVAL"
    elapsed=$(( elapsed + INTERVAL ))

    read -r java native pss <<< "$(get_memory)"
    cpu=$(get_cpu)

    echo "[BENCH] label=$LABEL, t=${elapsed}s, cpu=${cpu}%, java_heap=$(kb_to_mb $java)MB, native_heap=$(kb_to_mb $native)MB, total_pss=$(kb_to_mb $pss)MB"

    cpu_samples+=("$cpu")
    pss_samples+=("$pss")

    # Also grab recording state (skip in idle mode)
    if [[ "$SKIP_RECORDING" != "true" ]]; then
        state=$("$SCRIPT_DIR/app-state.sh" eval "__AGENTIC__.getState()" "${DEVICE_ARGS[@]:1}" 2>/dev/null | tr '\n' ' ' || echo "{}")
        duration_ms=$(echo "$state" | grep -oE '"durationMs"\s*:\s*[0-9]+' | tail -1 | grep -oE '[0-9]+' || echo "?")
        size_bytes=$(echo "$state" | grep -oE '"size"\s*:\s*[0-9]+' | tail -1 | grep -oE '[0-9]+' || echo "?")
        echo "[BENCH]   state: durationMs=$duration_ms, size=$size_bytes"
    fi
done

# ── Stop recording (unless skipped) ──
if [[ "$SKIP_RECORDING" == "true" ]]; then
    echo "[BENCH] Idle baseline complete, no recording to stop"
else
    echo "[BENCH] Stopping recording..."
    # Fire-and-store, same reason as the start above (#436).
    "$SCRIPT_DIR/app-state.sh" eval "(() => { globalThis.__BENCH = null; setTimeout(async () => { try { const s = await __AGENTIC__.stopRecording(); globalThis.__BENCH = (s && s.error) ? { err: String(s.error) } : { uri: s.fileUri, size: s.size, dur: s.durationMs } } catch (e) { globalThis.__BENCH = { err: String(e) } } }, 500); return 'scheduled' })()" "${DEVICE_ARGS[@]:1}" 2>/dev/null || true
    await_bench "stopRecording"
fi

# ── Final memory ──
read -r java_final native_final pss_final <<< "$(get_memory)"
cpu_final=$(get_cpu)
echo "[BENCH] label=$LABEL, t=final, cpu=${cpu_final}%, java_heap=$(kb_to_mb $java_final)MB, native_heap=$(kb_to_mb $native_final)MB, total_pss=$(kb_to_mb $pss_final)MB"

# ── Summary ──
# Compute average CPU
cpu_sum=0
for c in "${cpu_samples[@]}"; do
    # Handle float CPU values by truncating to int
    c_int=$(printf "%.0f" "$c" 2>/dev/null || echo 0)
    cpu_sum=$(( cpu_sum + c_int ))
done
cpu_avg=$(( cpu_sum / ${#cpu_samples[@]} ))

pss_start_mb=$(kb_to_mb "${pss_start:-0}")
pss_end_mb=$(kb_to_mb "${pss_samples[-1]:-0}")
pss_delta=$(( pss_end_mb - pss_start_mb ))

echo ""
echo "[BENCH-SUMMARY] label=$LABEL, duration=${DURATION}s, samples=${#cpu_samples[@]}, cpu_avg=${cpu_avg}%, mem_start=${pss_start_mb}MB, mem_end=${pss_end_mb}MB, mem_delta=${pss_delta}MB"
