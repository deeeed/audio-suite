# sherpa-onnx.rn — Upgrade Roadmap

## Phase 1: SDK 55 + New-Arch-Only Refactor (done)

The `feat/sherpa-onnx-upgrade` branch it was written on is merged and gone, and
`apps/sherpa-voice` has since moved past SDK 55 to Expo 57. Kept as the record of what
that refactor changed, not as current state.

### App (`apps/sherpa-voice`)
- `expo` bumped to `^55.0.0`, all expo-* packages updated via `npx expo install --fix`
- `newArchEnabled: true` removed from `app.config.ts` (mandatory in SDK 55, no longer a flag)
- `newArchEnabled=true` removed from `android/gradle.properties` (that file is a
  gitignored prebuild artifact, and Expo regenerates it with the flag set)
- `newArchEnabled` removed from `ios/Podfile.properties.json`

### Native package (`packages/sherpa-onnx.rn`)
- `SherpaOnnxModule.kt` and `SherpaOnnxPackage.kt` **still exist** under
  `android/src/main/kotlin/` and are still required — see Verification below. An earlier
  revision of this line said they were deleted, contradicting that entry and reading as
  evidence the Kotlin module was dead code (#458). What the old-architecture removal
  actually did to these two files is not recorded here; only that they remain.
- TurboModule files moved from `android/src/newarch/` to `android/src/main/kotlin/`
- `android/build.gradle`: removed `isNewArchitectureEnabled()` and all conditionals; `compileSdk`/`targetSdk` 33 → 34
- `sherpa-onnx-rn.podspec`: removed `fabric_enabled` conditionals; iOS min `11.0` → `13.4`
- `ios/bridge/SherpaOnnxRnModule.h`: removed `#ifdef RCT_NEW_ARCH_ENABLED` guards
- `ios/bridge/SherpaOnnxRnModule.mm`: removed old-arch `#ifdef` blocks. The
  `RCT_EXPORT_METHOD` macros stayed: 60 of them still export the module's methods
- `react-native.config.js`: **still registers the Android package** — `packageImportPath`
  and `packageInstance` are both present, and required. An earlier revision claimed this
  was removed, which is the same wrong assumption that made the Kotlin module look dead
  (#458).
- `src/NativeSherpaOnnxSpec.ts`: removed fallback chain; simplified to `TurboModuleRegistry.getEnforcing`

### Verification
- `npx expo-doctor` shows no SDK mismatches in `apps/sherpa-voice`
- App builds on Android + iOS without errors
- The Kotlin module still extends `ReactContextBaseJavaModule` and `SherpaOnnxPackage`
  still implements `ReactPackage`, and both are still registered. That is correct: under
  RN 0.86's interop layer this is how the module registers, and removing it breaks
  registration. An earlier revision of this line claimed the grep returned nothing, which
  was false and read as evidence the Kotlin module was dead code (#458).
- Home screen shows system info from native module

---

## Phase 2: sherpa-onnx C++ Library Upgrade

**Status**: Overtaken by events. This was written targeting v1.12.28; `package.json`
now pins `sherpaOnnxVersion: 1.13.0`, so the upgrade happened and went past that
target. The steps below describe the v1.12.28 move and are kept for history, not as
work to do (#458).

### Strategy
Switch from the stale `deeeed/sherpa-onnx#webwasm` fork to official `k2-fsa/sherpa-onnx` releases.
Use pre-built binaries from GitHub releases (v1.12.28) rather than building from source.

### Files to modify
- `install.js` — update `BINARY_VERSION` and download URLs to k2-fsa releases
- `build-sherpa-android.sh` — switch source URL to `https://github.com/k2-fsa/sherpa-onnx`, tag `v1.12.28`
- `build-sherpa-ios.sh` — same URL update + OnnxRuntime version check
- `setup.sh` — switch clone from `deeeed/sherpa-onnx#webwasm` → `k2-fsa/sherpa-onnx@v1.12.28`
- `package.json` — bump version `0.1.0` → `0.2.0`

### API compatibility check
- Verify `SherpaOnnxImpl.kt`, `SherpaOnnxASRHandler.swift`, `SherpaOnnxTtsHandler.swift` compile against v1.12.28 C API
- Key header: `sherpa-onnx-c-api.h` — check for breaking changes

### Verification
- `SherpaOnnx.getSystemInfo()` returns version string containing `1.12.28`
- TTS and ASR calls succeed on-device (no crashes)

---

## Phase 3: Agentic Validation Loop for sherpa-voice

**Status**: Done (implemented in this branch)

### What was added
- `apps/sherpa-voice/src/agentic-bridge.ts` — installs `globalThis.__AGENTIC__` with navigation, state, and fire-and-store test methods
- `apps/sherpa-voice/src/components/AgenticBridgeSync.tsx` — invisible sync component
- `apps/sherpa-voice/src/app/_layout.tsx` — imports `AgenticBridgeSync`
- `apps/sherpa-voice/scripts/agentic/` — CDP bridge scripts (copied from playground, port 7500)
- `apps/sherpa-voice/docs/AGENT_STARTING_TEMPLATE.md` — step-by-step workflow
- `apps/sherpa-voice/docs/AGENTIC_FEEDBACK_LOOPS.md` — quick reference

### Verification
```bash
cd apps/sherpa-voice
node scripts/agentic/cdp-bridge.mjs list-devices
scripts/agentic/app-state.sh eval "__AGENTIC__.testSystemInfo()"
sleep 3
scripts/agentic/app-state.sh eval "__AGENTIC__.getLastResult()"
```

---

## Deferred: Web/WASM Fork

**Repo**: `deeeed/sherpa-onnx` (branch: `webwasm`)

The fork builds a single combined WASM file (`sherpa-onnx-wasm-combined.wasm`) for React Native Web / Expo Web, instead of upstream's per-module approach.

**Key files in fork**:
- `packages/sherpa-onnx.rn/src/WebSherpaOnnxImpl.ts`
- `packages/sherpa-onnx.rn/build-sherpa-wasm.sh`

`src/WebUtils.ts` was in this list and has since been deleted. The built assets it
mentions, `apps/sherpa-voice/public/wasm/`, are not committed either: that directory is
produced by the build script.

**Known issue**: Shared memory/context between combined modules (documented in fork's ISSUE.md).

**TODO**: Rebase `webwasm` branch onto upstream v1.12.28, then re-evaluate contributing combined WASM approach back upstream as opt-in feature.
