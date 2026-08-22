# Testing Strategy for expo-audio-studio

## Overview

The expo-audio-studio library uses a **CDP bridge validation system** for fast, reliable validation during development. Agents interact with the running app directly via Chrome DevTools Protocol, proving features work on real devices in under 2 minutes.

## Core Philosophy

- **Fast feedback** — < 2 minutes to validate features on real devices
- **Real testing over mocked** — validate actual API behavior, not simulations
- **Automated feedback loops** — the key to 10x productivity
- **Quality over speed** — prevent regressions from reaching the team

## Validation Approach

### Primary: CDP Bridge (Real-device validation)

Two bridges cover all platforms:

| Bridge | Platforms | Transport |
|--------|-----------|-----------|
| `scripts/agentic/cdp-bridge.mjs` | Android, iOS | WebSocket to Hermes via Metro `/json/list` |
| `scripts/agentic/web-browser.mjs` | Web | Playwright CDP to Chromium |

Both expose the same `globalThis.__AGENTIC__` API inside the app runtime:

```
.navigate(path)          → push route
.getRoute()              → { pathname, segments }
.getState()              → { isRecording, isPaused, durationMs, size, analysisData, compression }
.startRecording(config)  → StartRecordingResult | { error }
.stopRecording()         → AudioRecording | null | { error }
.pauseRecording()        → true | { error }
.resumeRecording()       → true | { error }
```

### Shell Utility Scripts

Thin wrappers around the CDP bridges for common tasks:

```bash
scripts/agentic/app-navigate.sh "/(tabs)/record"   # Navigate
scripts/agentic/app-state.sh state                  # Query state
scripts/agentic/app-state.sh route                  # Query route
scripts/agentic/screenshot.sh my-label              # Screenshot
scripts/agentic/reload-metro.sh                     # Hot reload
scripts/agentic/start-metro.sh                      # Start Metro
scripts/agentic/stop-metro.sh                       # Stop Metro
```

### Optional: Detox / Playwright E2E

Full E2E test suites exist for CI pipelines:

```bash
cd apps/playground
yarn e2e:android:agent-validation    # Detox on Android
yarn e2e:ios:agent-validation        # Detox on iOS
yarn playwright test                 # Playwright on web
```

## Recording Validation Workflow

The most common validation pattern — prove recording works via CDP:

```bash
# 1. Navigate to record screen
scripts/agentic/app-navigate.sh "/(tabs)/record"

# 2. Start recording, hold ~3s, stop — all inside the scheduled callback.
# Recording via CDP must be fire-and-store: an eval that leaves a recording promise outstanding as audio starts
# flowing crashes the app (#436). See CLAUDE.md "Recording via CDP".
scripts/agentic/app-state.sh eval "(() => { globalThis.__V = {}; setTimeout(async () => { try { const r = await __AGENTIC__.startRecording({ sampleRate: 44100, channels: 1 }); if (r && r.error) { globalThis.__V = { err: r.error }; return } await new Promise(r2 => setTimeout(r2, 3000)); const s = await __AGENTIC__.stopRecording(); globalThis.__V = (s && s.error) ? { err: s.error } : { uri: s.fileUri, size: s.size, dur: s.durationMs } } catch (e) { globalThis.__V = { err: String(e) } } }, 1500); return 'scheduled' })()"

# 3. Poll state while it is still recording. The callback fires at 1.5s and stops at
# ~4.5s, so this must land inside that window — sleeping past it reports isRecording:
# false and proves nothing about the recording phase.
sleep 3
scripts/agentic/app-state.sh state
# → { isRecording: true, durationMs: ~1100, size: >0, ... }

# 4. Wait out the stop, then read the stored result. Polling during a recording is
# safe (see CLAUDE.md for what was measured); the point of waiting is simply that
# __V is not populated until the callback finishes.
sleep 7
scripts/agentic/app-state.sh eval "JSON.stringify(globalThis.__V)"
# → { uri: "file:///...wav", size: 259348, dur: 2939 }
# An { err: ... } here is a failure; an empty {} means the callback never completed.

# 5. Verify the recorder released
scripts/agentic/app-state.sh state
# → { isRecording: false, ... }
```

### Config Examples

```js
// Basic recording
{ sampleRate: 44100, channels: 1 }

// Compressed output
{ sampleRate: 44100, channels: 1, output: { compressed: { enabled: true, format: 'aac' } } }

// High-frequency analysis
{ sampleRate: 48000, intervalAnalysis: 25, interval: 10 }

// Stereo
{ sampleRate: 44100, channels: 2 }
```

## Platform Setup

```bash
# Android: Connect device or start emulator
adb devices

# iOS (macOS only): Boot simulator
xcrun simctl boot "iPhone 16 Pro Max"

# Web: Install Playwright
yarn playwright install chromium

# Start Metro (all platforms)
scripts/agentic/start-metro.sh
```

## Why CDP Bridge Testing?

### Problems with traditional approaches
- Slow feedback loops (10+ minutes)
- Complex test setup and maintenance
- Tests often mock behavior instead of testing real functionality

### CDP bridge benefits
- **Fast**: < 2 minutes to validate features
- **Real**: Tests actual API behavior on real devices
- **Direct**: No wrapper scripts or indirection
- **Programmable**: Agents call bridge commands directly

## Agent Requirements

### Mandatory
- Validate features via CDP bridge before claiming completion
- Test on a real device or simulator for **every platform the change affects**. One is
  enough only when the change touches one; see the hard rule in CLAUDE.md, which this
  previously contradicted by asking for "at least one".
- Fix issues immediately when validation fails
- Include actual command output in responses

### Never Do
- Skip validation
- Simulate test results
- Claim work complete without real testing

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Cannot reach Metro` | `scripts/agentic/start-metro.sh` |
| `No debug targets` | App not running on device/simulator |
| `__AGENTIC__ undefined` | Not in dev mode, or bridge not loaded |
| `No booted iOS simulator` | `xcrun simctl boot "iPhone 16 Pro Max"` |
| `No Android device` | `adb devices` — connect USB or start emulator |
| `Playwright not installed` | `yarn playwright install chromium` |

## Complete Documentation

See [Agentic Feedback Loops](../../../apps/playground/docs/AGENTIC_FEEDBACK_LOOPS.md) for the full reference.
