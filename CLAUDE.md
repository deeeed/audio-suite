# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

**expo-audio-stream** is a comprehensive audio processing monorepo for React Native and Expo applications. It provides real-time audio recording, analysis, visualization, and AI-powered processing capabilities across iOS, Android, and web platforms.

### Core Packages
- **`@siteed/expo-audio-studio`** - Main audio processing library with dual-stream recording, device management, and format conversion
- **`@siteed/audio-ui`** - React Native Skia-based audio visualization components (waveforms, spectrograms)
- **`@siteed/react-native-essentia`** - Advanced audio analysis using Essentia (feature extraction, classification)
- **`@siteed/sherpa-onnx.rn`** - Speech-to-text and text-to-speech capabilities (development)

### Applications
- **`apps/playground`** - Full-featured demo app showcasing all capabilities
- **`apps/minimal`** - Simple integration example
- **`apps/essentia-demo`** - Audio analysis demonstrations

## Agent Constraints
1. **NEVER IMPLEMENT UNLESS ASKED** - No unsolicited changes
2. **ALWAYS VERIFY IN SOURCE CODE** - No hallucinations accepted
3. **MINIMIZE DIFF** - Smallest possible changes
4. **NO WORKAROUNDS** - Fix root causes, not symptoms
5. **REAL TESTING ONLY** - No simulated results accepted

## Essential Commands

```bash
yarn install                    # Install dependencies
./scripts/setup-lfs.sh         # Setup Git LFS for models
cd apps/playground && yarn build:deps && yarn start  # Run playground app

# Building packages
yarn workspace @siteed/expo-audio-studio build
yarn workspace @siteed/audio-ui build
```

## Agentic Validation (CDP Bridge)

All agent commands run from `apps/playground/`. See `apps/playground/docs/AGENT_STARTING_TEMPLATE.md` for the step-by-step workflow.

```bash
node scripts/agentic/cdp-bridge.mjs list-devices     # List connected devices
scripts/agentic/app-navigate.sh "/(tabs)/record"      # Navigate
scripts/agentic/app-state.sh state                    # Query state
scripts/agentic/app-state.sh eval "__AGENTIC__.startRecording({ sampleRate: 44100, channels: 1 })"
scripts/agentic/screenshot.sh my-label                # Screenshot
scripts/agentic/reload-metro.sh                       # Hot reload after edits
scripts/agentic/native-logs.sh android|ios            # Kotlin/Swift logs
scripts/agentic/start-metro.sh                        # Start Metro (:7365)
```

All scripts accept `--device <name>` for multi-device targeting.

### Native Module Validation (fire-and-store pattern)

The agentic bridge exposes test methods for validating native module calls on-device. Since CDP uses `awaitPromise: false`, async results are stored and polled via `getLastResult()`.

```bash
# Test extractPreview (also exercises extractAudioAnalysis)
scripts/agentic/app-state.sh eval "__AGENTIC__.testExtractPreview()"
sleep 5
scripts/agentic/app-state.sh eval "__AGENTIC__.getLastResult()"

# Test extractAudioData
scripts/agentic/app-state.sh eval "__AGENTIC__.testExtractAudioData()"
sleep 3
scripts/agentic/app-state.sh eval "__AGENTIC__.getLastResult()"

# Test trimAudio
scripts/agentic/app-state.sh eval "__AGENTIC__.testTrimAudio()"
sleep 5
scripts/agentic/app-state.sh eval "__AGENTIC__.getLastResult()"

# Test extractMelSpectrogram (Android only)
scripts/agentic/app-state.sh eval "__AGENTIC__.testExtractMelSpectrogram()"
sleep 5
scripts/agentic/app-state.sh eval "__AGENTIC__.getLastResult()"
```

Each returns `{ op, status: 'pending' }` immediately. Poll `getLastResult()` for `status: 'success'` or `status: 'error'`. Always check `native-logs.sh android` for Kotlin bridge crashes after running these.

## Important Notes

- Always run `yarn build:deps` in playground before development
- Git LFS setup required for ONNX models
- Native changes require pod install (iOS) or gradle sync (Android)
- Background recording requires special permissions configuration
- **VPN Interference**: Disconnect VPNs during iOS E2E tests; Android uses ADB port forwarding (VPN-resistant)

## Dependency Strategy (Expo / React Native)

This monorepo uses Yarn 4 with `nodeLinker: node-modules` and `nmHoistingLimits: workspaces`. Each workspace gets its own `node_modules`, which makes it easy for nested packages to ship duplicate copies of singleton runtime packages such as `react`, `react-native`, or React Navigation packages. Two copies of any singleton in one bundle = silent context Symbol mismatch and a `<Stack>` / `<SceneView>` "Element type is invalid" crash that points at an unrelated provider in the stack trace.

Guard rails in place:
- Root `package.json` `resolutions` pins `react` and `react-dom` to one version per name.
- Expo Router SDK 56 bundles its React Navigation internals; app code should import router-owned entrypoints such as `expo-router/react-navigation`, `expo-router/js-tabs`, and `expo-router/stack` instead of direct `@react-navigation/*` packages.
- Apps may still provide `@react-navigation/native` only when a non-router library declares it as an external peer, for example `@siteed/design-system`; do not use that package for app-code navigation imports.
- `apps/playground/metro.config.cjs` force-resolves `react`, `react-dom`, and `react/jsx-{,dev-}runtime` to the playground copy via `resolveRequest`, and lists every nested workspace under `packageRoots` so blacklisted duplicates are excluded.
- `yarn check:deps` (`scripts/check-runtime-deps.sh`) walks `node_modules` and fails if any singleton package has more than one copy inside a workspace. Run after every dep change and before merging upgrade PRs.

When bumping Expo or React Native:
1. Run `yarn expo install --check` and apply the recommended versions.
2. Remove app-code direct `@react-navigation/*` imports and use Expo Router's SDK-specific entrypoints.
3. Re-run `yarn install` and `yarn check:deps`.
4. If `check:deps` fails, add the offending package to root `resolutions` and reinstall.

## iOS Simulator

Standard: **iPhone 16 Pro Max** — use `yarn setup:ios-simulator` for consistent setup.

- ❌ Change simulator without updating `.detoxrc.js`, `scripts/setup-simulators.sh`, `scripts/generate-screenshots.sh`

## Rules

**Device targeting**
- ❌ Use `IOS_SIMULATOR` or `ANDROID_DEVICE` env vars (removed)
- ✅ Use `--device <name>` flag when multiple devices are connected
- ❌ Silently fall through to a different platform when a device filter fails — fail loudly

**CDP bridge**
- ❌ Break `__AGENTIC__` API without updating all callers
- ✅ Validate all features via CDP bridge before claiming completion

**Cross-platform**
- ❌ Assume iOS and Android will behave identically — handle platform-specific timing
- ✅ Test on BOTH platforms for any UI or navigation changes

**Protected files — never modify without extreme caution:**
- `apps/playground/scripts/agentic/cdp-bridge.mjs` — unified CDP bridge
- `apps/playground/scripts/agentic/web-browser.mjs` — web browser lifecycle
- `apps/playground/.detoxrc.js` — device configs
- `/index.js` (monorepo root) — Storybook module resolution
- Before touching any: verify CDP bridge still works (`app-state.sh state`)

**Native modules**
- ❌ Pass `logger`, `ArrayBuffer`, functions, or class instances to Expo native modules — causes `"Cannot convert '[object Object]' to a Kotlin type"` on Android
- ✅ Only pass plain objects with primitive values, arrays, and nested plain objects
- ✅ Use `native-logs.sh android|ios` to check native-side errors on any native crash

**Android physical device connectivity** (Metro on :7365)
- ❌ `adb reverse tcp:8081 tcp:7365` — conflicts with other RN apps; also `expo run:android` resets this mapping
- ❌ Rely on ADB reverse for Metro connectivity — tunneling is unreliable for HTTP/WebSocket
- ✅ `adb reverse tcp:7365 tcp:7365` — but prefer LAN IP approach below
- ✅ Connect via LAN IP deep link for the dev build: `adb shell am start -a android.intent.action.VIEW -d "exp+audioplayground-development://expo-development-client/?url=http://<MAC_LAN_IP>:7365"`
- ✅ After `expo run:android`, re-run `adb reverse` (it resets port mappings)
- ✅ Disconnect WiFi ADB before commands: `adb disconnect <ip>:5555` (auto-reconnects and causes device selection hangs)
- ✅ After clearing app data: `adb shell pm grant <pkg> android.permission.RECORD_AUDIO`
- ✅ Plain `adb shell am start <package>/.MainActivity` to relaunch after force-stop

**iOS physical device connectivity** (Metro on :7365)
- ❌ Patch `RCTDefines.h` / `setPort.sh` — React-Core is prebuilt binary in Expo 54+, header patches have zero effect
- ❌ Use `localhost` for physical devices — that's the phone's own loopback, not the Mac
- ✅ Config plugin `withMetroPortIOS.cjs` injects `RCTBundleURLProvider.sharedSettings().jsLocation` with LAN IP
- ✅ Launch with `--payload-url`: `xcrun devicectl device process launch --device <UDID> --terminate-existing --payload-url "exp+audioplayground-development://expo-development-client/?url=http%3A%2F%2F<MAC_LAN_IP>%3A7365" <bundle-id>`
- ✅ Verify after prebuild: check `ios/<Scheme>/AppDelegate.swift` contains `jsLocation` with correct IP

**Metro port resource override (Android)**
- ReactAndroid ships static `values.xml` with `react_native_dev_server_port = 8081` — this wins over `resValue()` in cached builds
- `withMetroPort.cjs` writes `app/src/main/res/values/dev_server_port.xml` to override at app level (app resources always beat library resources)
- After changing port config: `./gradlew :app:clean :app:installDebug` (incremental builds serve stale resources)
- Verify with: `aapt dump resources app-debug.apk | grep react_native_dev_server_port` — check hex value (0x1cc5 = 7365, 0x1f91 = 8081)

**Builds / type-checking**
- ✅ `yarn workspace <pkg> build` (~1.5s) for single-package changes
- ❌ Full monorepo `tsc --noEmit` for single-file changes — floods output with unrelated errors

**EAS / prebuild — critical rules**
- ❌ `expo prebuild` from monorepo root — creates spurious `/app.json` and `/eas.json` at root and contaminates the workspace
- ✅ All prebuild/build commands run from `apps/playground/` only
- ❌ `expo prebuild --clean` manually before a local EAS build — EAS local builds manage their own temp dir; manual prebuild is only for Xcode/screenshots workflows
- ❌ `expo prebuild --clean --platform android` to "fix" build issues — it nukes the platform dir (gitignored, no recovery) and can remove autolinked dependencies (e.g. expo-splash-screen → ClassNotFoundException)
- ✅ `yarn expo prebuild --platform android` (without --clean) to re-link modules after dependency changes
- ✅ After prebuild --clean: verify no ClassNotFoundException in logcat before debugging further
- ✅ Local builds: `yarn build:ios:production:local` / `yarn build:android:production:local` (both run `eas build --local`)
- ✅ Switch ios/ variant via setup scripts only: `yarn setup:development` / `yarn setup:production`
- ✅ After accidental production prebuild, restore dev workspace: `git checkout -- apps/playground/ios/`
- ios/ workspace name reveals current variant: `AudioDevPlayground.*` = dev/preview, `AudioPlayground.*` = production

## Documentation

- **Agentic workflow**: `apps/playground/docs/AGENT_STARTING_TEMPLATE.md`
- **CDP bridge details**: `apps/playground/docs/AGENTIC_FEEDBACK_LOOPS.md`
- **Testing strategy**: `packages/expo-audio-studio/docs/TESTING_STRATEGY.md`

## Task Tracking

Maintain a `.task.md` file in the project root. Update it:
- **START** of any task → status: `working`, describe what you're doing
- When **BLOCKED** → status: `blocked`, describe why
- When **DONE** → status: `done`, summarize what was completed
- When **IDLE** → status: `idle`

Format:
```
## Current Task
<one-liner describing the goal>

## Status
working|blocked|done|idle

## Approach
<1-2 sentences on HOW you're solving it — enough to judge direction>

## Progress
- bullet 1
- bullet 2
- bullet 3 (3-5 max)

## Last Updated
<timestamp>
```

This file is read by the orchestrator to track progress across sessions. Keep it high-level.

IMPORTANT: A fix is NOT done until validated on-device via the feedback loop. Do not mark status as done until:
- Code changes are built and deployed to the device(s)
- The bug scenario is reproduced and confirmed fixed
- Regressions are checked
Use status: `needs-validation` for code-complete but unverified fixes.

**Fast Android builds for native module changes**
- ❌ `yarn android` for single-module Kotlin/Java changes — full rebuild, 5-10 min
- ✅ `cd apps/playground/android && ./gradlew :sherpa-onnx-rn:assembleDebug :app:installDebug` — incremental, ~1-2 min
- ✅ For expo-audio-stream module: `./gradlew :expo-audio-stream:assembleDebug :app:installDebug`
- ✅ Just reinstall (no code change): `./gradlew :app:installDebug`
- Prebuilt .so files: just copy + `./gradlew :app:installDebug` (no native compile needed)
