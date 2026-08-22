#!/usr/bin/env bash
# benchmark-recording.sh — Automated recording performance benchmark
#
# Usage:
#   benchmark-recording.sh [--duration <seconds>] [--label <name>] [--config <json>] [--interval <seconds>] [--device <name>]
#
# Measures CPU, Java Heap, Native Heap, and Total PSS at regular intervals
# during a recording session. Outputs [BENCH] lines and a final [BENCH-SUMMARY].

set -euo pipefail

# Set once startRecording is confirmed, so the traps below know to stop it.

# Stop a recording this script started before leaving. Without it any abort after the
# start left the device recording indefinitely, since the default config has no
# maxDurationMs — a failed benchmark that keeps the microphone open.
# Identifies this run inside the app, so a later run cannot clear an earlier run's
# abandon marker or claim its result. pid plus seconds alone can repeat after PID reuse
# within the same second or a clock rollback, so a random field is mixed in. Hex and
# hyphens only: it is interpolated into a single-quoted JS string.
RUN_TOKEN="$$-$(date +%s)-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"

stop_recording_if_running() {
    # One atomic step on the JS side: mark the run abandoned, and stop the recording only
    # if this run's callback actually started it. Doing it in the app avoids the window
    # between the callback succeeding and the shell learning about it, and means a start
    # that failed with ALREADY_RECORDING never causes us to stop someone else's recording.
    #
    # Ownership moves to a stopping state rather than being cleared outright: if the eval
    # never reaches the device, a retry must still know there is a recording to stop.
    # Clearing first meant one transient CDP failure stranded a live recording.
    local attempt result
    for attempt in 1 2 3; do
        result=$("$SCRIPT_DIR/app-state.sh" eval "(() => { const t = '$RUN_TOKEN'; if (globalThis.__BENCH_RUN !== t) { return 'not-ours' } globalThis.__BENCH_ABANDONED = true; if (!globalThis.__BENCH_OWNED && !globalThis.__BENCH_STOPPING) { return 'nothing-owned' } globalThis.__BENCH_OWNED = false; globalThis.__BENCH_STOPPING = true; try { __AGENTIC__.stopRecording() } catch (e) { return 'stop-threw' } globalThis.__BENCH_STOPPING = false; return 'stopped' })()" \
            "${DEVICE_ARGS[@]:1}" 2>/dev/null) || result=""
        case "$result" in
            *not-ours*|*nothing-owned*|*stopped*) return 0 ;;
        esac
        # Either the eval never landed or stopRecording threw. Both are retryable, and the
        # stopping state above means the next attempt still sees something to stop.
        echo "[BENCH] stop attempt $attempt did not confirm; retrying" >&2
        sleep 1
    done
    echo "[BENCH] WARNING: could not confirm the recording stopped after 3 attempts." >&2
    echo "[BENCH] A recording may still be running on the device." >&2
}

# The sampling helpers run inside $(...), where `exit` would only end the subshell. They
# signal the top-level shell instead, and this trap turns that into a real failure.
trap 'echo "[BENCH] aborted" >&2; stop_recording_if_running; exit 1' TERM
trap 'stop_recording_if_running' EXIT

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
        # adb prints `model:Pixel_6a`, while the CDP bridge labels the same phone
        # "Pixel 6a - 17 - API 37". Accept either: take the part before the first " - ",
        # then match spaces against underscores too. Without the first step the bridge's
        # own device name — the one every other script here takes — was rejected outright.
        local dev_short="${dev_name%% - *}"
        local dev_pattern="${dev_short// /[ _]}"
        local matches
        matches=$(adb devices -l | grep -iE "$dev_pattern" | awk '{print $1}')
        local match_count
        match_count=$(printf '%s\n' "$matches" | grep -c . || true)
        if [[ "$match_count" -gt 1 ]]; then
            # Taking the first match silently benchmarked whichever phone adb listed
            # first, while CDP drove the one the caller actually named.
            echo "[BENCH] FATAL: '$dev_name' matches $match_count devices:" >&2
            adb devices -l | grep -iE "$dev_pattern" >&2
            echo "[BENCH] Use a name that matches exactly one, or disconnect the others." >&2
            echo "[BENCH] An adb serial does not work here: CDP filters on device labels." >&2
            exit 1
        fi
        serial=$(printf '%s\n' "$matches" | head -1)
        if [[ -n "$serial" ]]; then
            echo "$serial"
            return
        fi
        # No fallback on an explicit request. Falling through here benchmarked a
        # different phone than the caller named — with a Pixel 7 listed first, asking
        # for a Pixel 6a silently measured the Pixel 7.
        echo "[BENCH] FATAL: device '$dev_name' not found among:" >&2
        adb devices -l >&2
        exit 1
    fi
    # Prefer USB-connected device over WiFi
    local serial
    serial=$(adb devices -l | grep -E "usb:" | awk '{print $1}' | head -1)
    if [[ -z "$serial" ]]; then
        serial=$(adb devices | grep -v "^List" | grep -v "^$" | head -1 | awk '{print $1}')
    fi
    echo "$serial"
}

# Resolved once, here, at the top level. Lazily resolving inside run_adb did not work:
# run_adb is itself called from `$(get_memory)`, and bash disables errexit inside command
# substitution — so both resolve_serial's `exit 1` and run_adb's own guard killed only the
# subshell, get_memory returned empty, and the benchmark carried on to print a successful
# summary full of zeroes. Doing it before any substitution is what makes the failure fatal.
# Rejecting the ambiguous case is not enough: leaving the filter empty means a target
# that connects mid-run silently restores broadcasting, and the EXIT trap broadcasts too.
# So the sole target is discovered once and pinned into DEVICE_ARGS for every command.
if [[ ${#DEVICE_ARGS[@]} -le 1 ]]; then
    CDP_NAMES=$(node "$SCRIPT_DIR/cdp-bridge.mjs" list-devices 2>/dev/null \
        | sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    CDP_COUNT=$(printf '%s' "$CDP_NAMES" | grep -c . || true)
    if [[ "${CDP_COUNT:-0}" -ne 1 ]]; then
        echo "[BENCH] FATAL: ${CDP_COUNT:-0} CDP targets are connected; pass --device <name>." >&2
        echo "[BENCH] Commands would otherwise broadcast to all of them." >&2
        exit 1
    fi
    DEVICE_ARGS=("" --device "$CDP_NAMES")
    echo "[BENCH] Pinned sole CDP target: $CDP_NAMES" >&2
    # Metrics must come from the phone the recording runs on. Without this the serial was
    # resolved independently, so with several phones attached and one CDP target the
    # summary could describe a different device than the one being recorded.
    DEVICE_NAME="$CDP_NAMES"
fi

ADB_SERIAL="$(resolve_serial)"
if [[ -z "$ADB_SERIAL" ]]; then
    echo "[BENCH] FATAL: no usable device serial." >&2
    exit 1
fi
echo "[BENCH] Using device serial: $ADB_SERIAL" >&2

run_adb() {
    adb -s "$ADB_SERIAL" "$@"
}

# Helper: get memory stats — returns "java_heap native_heap total_pss" in KB
get_memory() {
    local meminfo
    # Checked explicitly: this runs inside $(...), where bash disables errexit, so a
    # failing adb would otherwise fall through to the zero defaults below and be reported
    # as a successful benchmark.
    if ! meminfo=$(run_adb shell dumpsys meminfo "$APP_PKG" 2>/dev/null) || [[ -z "$meminfo" ]]; then
        echo "[BENCH] FATAL: could not read meminfo from $ADB_SERIAL" >&2
        kill -TERM $$
    fi
    # dumpsys exits 0 and prints "No process found" when the app has died, which otherwise
    # became zero samples and a clean summary over a process that was not running.
    if printf '%s' "$meminfo" | grep -qi "No process found"; then
        echo "[BENCH] FATAL: $APP_PKG is not running on $ADB_SERIAL" >&2
        kill -TERM $$
    fi
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
    local top_out
    # Same reason as get_memory: an adb failure here must not become a 0% sample.
    if ! top_out=$(run_adb shell top -b -n 1 -q 2>/dev/null); then
        echo "[BENCH] FATAL: could not read top from $ADB_SERIAL" >&2
        kill -TERM $$
    fi
    local cpu
    cpu=$(printf '%s\n' "$top_out" | grep "$APP_PKG" | head -1 | awk '{print $9}')
    # An absent process line is a real 0 for a backgrounded app, not a failure.
    echo "${cpu:-0}"
}

# Convert KB to MB (integer)
kb_to_mb() {
    echo $(( ${1:-0} / 1024 ))
}

# Poll the stored fire-and-store outcome. Without this the benchmark reports a summary
# even when startRecording/stopRecording failed outright.
await_bench() {
    local what="$1" phase="$2" raw
    # Wall clock, not a poll count. Each CDP call can take ten seconds or more, so
    # counting iterations meant the "20 second" budget could run for minutes.
    local deadline=$(( $(date +%s) + 20 ))
    while (( $(date +%s) < deadline )); do
        # Do NOT JSON.stringify here: the bridge already encodes the returned value, so a
        # stringified object arrives as "{\"started\":true}" and no grep for the inner
        # quotes can match. Emit a flat, unambiguous marker string instead.
        # The token check is what stops a concurrent run's result from being accepted as ours.
        raw=$("$SCRIPT_DIR/app-state.sh" eval "(() => { if (globalThis.__BENCH_RUN !== '$RUN_TOKEN') return 'BENCH_STOLEN'; const b = globalThis.__BENCH; if (!b) return 'BENCH_PENDING'; if (b.err) return 'BENCH_ERR ' + b.err; return 'BENCH_OK ' + (b.phase || '?') + ' ' + (b.uri || '') + ' size=' + (b.size === undefined ? '' : b.size) + ' dur=' + (b.dur === undefined ? '' : b.dur) })()" "${DEVICE_ARGS[@]:1}" 2>/dev/null | tr -d '\n' || true)
        # Another run took the globals, or the app reloaded and cleared them. Either way
        # this run can no longer tell what happened to its recording, so it must not
        # report success and must not stop whatever is running now.
        if echo "$raw" | grep -q 'BENCH_STOLEN'; then
            echo "[BENCH] FATAL: this run no longer owns the app globals (concurrent run or app reload)." >&2
            exit 1
        fi
        if echo "$raw" | grep -q 'BENCH_ERR'; then
            echo "[BENCH] FATAL: $what failed: $raw" >&2
            exit 1
        fi
        # The phase tag must match: without it a stop whose dispatch silently no-opped
        # would read the start's marker and be reported as a successful stop.
        if echo "$raw" | grep -q "BENCH_OK $phase"; then
            echo "[BENCH] $what ok: $raw"
            return 0
        fi
        sleep 1
    done
    echo "[BENCH] FATAL: $what produced no result within 20s (last: ${raw:-<none>})" >&2
    exit 1
}

# ── Check for skipRecording mode ──
SKIP_RECORDING=false
if echo "$CONFIG" | grep -qE '"skipRecording"\s*:\s*true'; then
    SKIP_RECORDING=true
fi

# ── Require exactly one CDP target ──
# Without --device the bridge broadcasts to every connected target, while metrics come
# from a single adb device — a recording could start on a phone this run never measures
# and never stops.
# ── Navigate to record screen ──
echo "[BENCH] Navigating to record screen..."
if ! "$SCRIPT_DIR/app-navigate.sh" "/(tabs)/record" "${DEVICE_ARGS[@]:1}"; then
    echo "[BENCH] FATAL: could not navigate to the record screen." >&2
    exit 1
fi
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
    # Fire-and-store: an eval that leaves a recording promise outstanding as audio starts flowing crashes the app
    # (#436). Schedule the call so the eval returns before the first buffer lands.
    START_DISPATCH=$("$SCRIPT_DIR/app-state.sh" eval "(() => { const t = '$RUN_TOKEN'; const prev = globalThis.__BENCH_RUN; if (prev && prev !== t && (globalThis.__BENCH_PENDING || globalThis.__BENCH_OWNED || globalThis.__BENCH_STOPPING)) { return 'busy' } globalThis.__BENCH = null; globalThis.__BENCH_RUN = t; globalThis.__BENCH_PENDING = true; globalThis.__BENCH_OWNED = false; globalThis.__BENCH_STOPPING = false; globalThis.__BENCH_ABANDONED = false; setTimeout(async () => { if (globalThis.__BENCH_RUN !== t) { return } let r; try { r = await __AGENTIC__.startRecording($CONFIG) } catch (e) { if (globalThis.__BENCH_RUN === t) { globalThis.__BENCH_PENDING = false; globalThis.__BENCH = { err: String(e), phase: 'start' } } return } if (globalThis.__BENCH_RUN !== t) { return } if (r && r.error) { globalThis.__BENCH_PENDING = false; globalThis.__BENCH = { err: String(r.error), phase: 'start' }; return } globalThis.__BENCH_OWNED = true; if (globalThis.__BENCH_ABANDONED) { try { await __AGENTIC__.stopRecording() } catch (e2) {} globalThis.__BENCH_OWNED = false; globalThis.__BENCH_PENDING = false; globalThis.__BENCH = { err: 'abandoned before confirmation', phase: 'start' }; return } globalThis.__BENCH_PENDING = false; globalThis.__BENCH = { started: true, phase: 'start' } }, 500); return 'scheduled' })()" "${DEVICE_ARGS[@]:1}") || {
        echo "[BENCH] FATAL: could not dispatch startRecording." >&2
        exit 1
    }
    # Another run is starting, owns a recording, or is still stopping one. Seizing the
    # globals here would strand its recording: it would see BENCH_STOLEN and refuse to
    # tear down, while this run would only get ALREADY_RECORDING.
    if [[ "$START_DISPATCH" == *busy* ]]; then
        echo "[BENCH] FATAL: another benchmark run owns the app right now." >&2
        echo "[BENCH] Wait for it to finish, or stop it, before starting another." >&2
        exit 1
    fi
    # __BENCH_OWNED, set by the callback itself, is the real record of ownership. The
    # shell flag cannot be: it is only assigned once await_bench returns, leaving a window
    # where the recording is live but no shell variable says so.
    await_bench "startRecording" start
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
    STOP_DISPATCH=$("$SCRIPT_DIR/app-state.sh" eval "(() => { const t = '$RUN_TOKEN'; if (globalThis.__BENCH_RUN !== t) { return 'not-ours' } globalThis.__BENCH = null; setTimeout(async () => { if (globalThis.__BENCH_RUN !== t) { return } globalThis.__BENCH_OWNED = false; try { const s = await __AGENTIC__.stopRecording(); if (globalThis.__BENCH_RUN !== t) { return } globalThis.__BENCH = (s && s.error) ? { err: String(s.error), phase: 'stop' } : { uri: s.fileUri, size: s.size, dur: s.durationMs, phase: 'stop' } } catch (e) { if (globalThis.__BENCH_RUN === t) { globalThis.__BENCH = { err: String(e) } } } }, 500); return 'scheduled' })()" "${DEVICE_ARGS[@]:1}") || {
        echo "[BENCH] FATAL: could not dispatch stopRecording." >&2
        exit 1
    }
    # 'not-ours' means a concurrent run or an app reload replaced this run's globals. The
    # recording is no longer ours to stop, and reporting a summary for it would be a lie.
    if [[ "$STOP_DISPATCH" == *not-ours* ]]; then
        echo "[BENCH] FATAL: this run no longer owns the app globals (concurrent run or app reload)." >&2
        echo "[BENCH] Not stopping the recording: it belongs to whatever replaced this run." >&2
        exit 1
    fi
    await_bench "stopRecording" stop
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
# ${arr[-1]} is a bash 4 feature; /bin/bash on macOS is 3.2 and errors with "bad array
# subscript", which produced a false mem_end=0MB in an otherwise successful summary.
pss_end_mb=$(kb_to_mb "${pss_samples[$(( ${#pss_samples[@]} - 1 ))]:-0}")
pss_delta=$(( pss_end_mb - pss_start_mb ))

echo ""
echo "[BENCH-SUMMARY] label=$LABEL, duration=${DURATION}s, samples=${#cpu_samples[@]}, cpu_avg=${cpu_avg}%, mem_start=${pss_start_mb}MB, mem_end=${pss_end_mb}MB, mem_delta=${pss_delta}MB"
