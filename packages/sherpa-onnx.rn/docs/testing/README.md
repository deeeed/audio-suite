# Native Integration Testing

This directory contains documentation for the native integration testing framework for sherpa-onnx.rn.

## Framework Overview

The native integration testing framework is meant to validate React Native module
integration with the sherpa-onnx C++ library on Android and iOS. Neither half runs today:
Android is blocked by #475 and iOS has no XCTest target, so what follows describes the
intent and the sources, not working validation.

### Key Features

- ✅ **Android instrumented tests** - iOS has XCTest sources but no target to run them
- ✅ **Lightweight model management** - CI-friendly testing without large model downloads
- ✅ **Native library validation** - Confirms JNI/Swift bridge functionality
- ✅ **Tiered testing strategy** - From basic validation to full functionality testing
- ✅ **Feedback loop methodology** - Write test → Run → Fix → Validate cycle

## Test Results

**Historical Android result**: 12/12 passed when these were last runnable. They do not
run today: the instrumentation APK is missing the React Native libraries and the test
manifest lacks `INTERNET` (#475). Treat the numbers below as a record, not current state.
- **BasicIntegrationTest**: 7 tests validating module structure and native integration
- **TtsIntegrationTest**: 5 tests validating model management and TTS functionality
- **Execution time**: ~0.05 seconds for complete test suite

## Documentation Structure

- [`native-integration-testing.md`](./native-integration-testing.md) - Core framework methodology
- [`model-strategy.md`](./model-strategy.md) - Model management strategy for testing
- [`validation-results.md`](./validation-results.md) - Complete test results and analysis
- [`platform-differences.md`](./platform-differences.md) - Android vs iOS testing considerations

## Quick Start

The commands below are wired up but do not currently pass: the instrumentation APK is
missing the React Native libraries and the test manifest lacks `INTERNET` (#475).

### Run Android Tests
```bash
cd packages/sherpa-onnx.rn
yarn test:android
```

### View Test Results
```bash
# Android test reports
open android/build/reports/androidTests/connected/debug/index.html
```

### Test Development Workflow
1. **Write failing test** that demonstrates desired functionality
2. **Run tests** to confirm failure and understand requirements
3. **Implement functionality** to make test pass
4. **Validate** that test passes and no regressions occur

## Architecture

The repo is new-architecture only (#457), so there is one architecture to test:
- **New Architecture** (Fabric + TurboModules) - JSI direct calls

Old-architecture and bridgeless testing were removed with the comparison tests in #434.

## Model Management

Lightweight model strategy optimized for different testing environments:
- **CI Testing** (< 100MB): Model configuration validation only
- **Development Testing** (< 500MB): Lightweight models for real functionality
- **Full Testing** (< 1.5GB): Complete model suite for production validation

## Next Steps

Architecture-specific testing is no longer planned: the repo is new-architecture only
(#457), and the old-vs-new comparison tests were deleted in #434. The
`next-validation-phase.md` this used to link to does not exist (#458).