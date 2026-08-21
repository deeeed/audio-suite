# Integration Testing Guide

## Overview

This guide covers integration testing for sherpa-onnx.rn across all platforms, with focus on validating React Native architecture compatibility, native build health, and real model roundtrips. Keep build validation and runtime ASR validation separate: a successful `assembleDebug` or `xcodebuild` proves the native project links, but it does not prove that a model initializes and decodes audio on a device.

## Test Categories

### 1. Module registration and system info

**Android**: `android/src/androidTest/java/net/siteed/sherpaonnx/SystemInfoTest.kt`

**iOS**: `ios/SherpaOnnxTests/SystemInfoIntegrationTest.swift`

There is no old-vs-new architecture comparison. `ArchitectureCompatibilityTest.kt` and
`ArchitectureSpecificTest.kt` were deleted in #434 when the repo went new-architecture
only (#457), and nothing replaced them — the comparison had nothing left to compare.

Note that `SherpaOnnxModule` still extends `ReactContextBaseJavaModule` and
`SherpaOnnxPackage` still implements `ReactPackage`. That is not leftover old-architecture
code: under RN 0.86's interop layer it is how the module registers, and removing it breaks
registration.

### 2. System Information Validation ✅

Tests the comprehensive system info API:
- Device capabilities (CPU, memory, GPU)
- Architecture detection
- Performance metrics
- Platform-specific features (Metal on iOS, Vulkan on Android)

### 3. Real Model Integration Tests ✅

**Android Only**: Tests with lightweight ONNX models
- TTS functionality with vits-icefall-en-low (30.3MB)
- ASR functionality with whisper-tiny (37.3MB)  
- VAD with silero-vad (2.2MB)
- Model lifecycle management
- Memory leak detection

## Running Tests

### Android Integration Tests

The package ships a script that already has the right app directory and module name:

```bash
yarn workspace @siteed/sherpa-onnx.rn test:android
```

which runs:

```bash
cd apps/sherpa-voice/android && ./gradlew :siteed_sherpa-onnx.rn:connectedAndroidTest
```

Sherpa's Android module lives under `apps/sherpa-voice`, not `apps/playground`, and the
gradle project is `:siteed_sherpa-onnx.rn`. The previously documented
`:siteed-expo-audio-studio` does not resolve from either app.

To run one class:

```bash
cd apps/sherpa-voice/android
APP_VARIANT=development ./gradlew :siteed_sherpa-onnx.rn:connectedAndroidTest \
  --tests "*RealTtsFunctionalityTest"
```

The classes that exist: `AudioTrackPrefillTest`, `BasicIntegrationTest`,
`ComprehensiveIntegrationTestSuite`, `MemoryAndPerformanceProfilerTest`,
`RealAsrFunctionalityTest`, `RealTtsFunctionalityTest`, `SystemInfoTest`,
`TestModelManagementTest`, `TestReactContextDispatchTest`, `TtsIntegrationTest`,
`WaveReaderJniTest`. There is no `RealModelIntegrationTest`.

### iOS Integration Tests

```bash
# What the iOS suite needs, and why it is not a one-liner
yarn workspace @siteed/sherpa-onnx.rn test:ios:info

# Via Xcode
open sherpaonnxdemo.xcworkspace
# Select test target and run
```

### Web Testing

```bash
# Browser-based validation
cd apps/sherpa-voice
yarn web
```

Useful browser-side checks:

- smoke-load the WASM runtime and selected feature modules
- run `__AGENTIC__.testASR('streaming')` for the default streaming backend
- run `__AGENTIC__.testASR('qwen3')` for Qwen3-ASR with the hosted Mandarin sample

## Test Results Summary

These are historical results from when the suite last ran in full. Re-run before
trusting them; the architecture-comparison lines are from before #434 removed those tests.

### Android (Real Device - Pixel 6a) ✅
```
System Information: ✅ PASS
- Device info: Complete
- GPU: Vulkan support detected
- Memory: 8GB total, detailed breakdown

Real Model Integration: ✅ PASS (26/26 tests)
- TTS: Generated audio successfully
- ASR: Recognition working
- Model Management: No memory leaks
- Performance: Within acceptable bounds
```

### iOS (Simulator - iPhone 16 Pro) ✅
```
System Information: ✅ PASS
- Device info: Complete iOS system info
- GPU: Metal support detected  
- Memory: 131GB simulator memory
- Performance: <10ms response time
```

### Web (Chrome/Safari)
```
System Information: ✅ PASS
- Browser detection working
- WebGL support detected
- Performance API available

Model Integration:
- WASM runtime and feature module loading should be validated on every release
- Qwen3-ASR can be validated end-to-end with `__AGENTIC__.testASR('qwen3')`
- Large specialized backends use the same web ASR path but may be impractical in routine browser validation
```

### Native Runtime ASR

For native platforms, do not treat build-only checks as ASR validation. Runtime validation means launching the app on a simulator/device with the target model present and running the bridge roundtrip:

```javascript
__AGENTIC__.testASR('streaming')
__AGENTIC__.testASR('qwen3')
```

If models are not already on the device, use the download-and-test recipes under `apps/sherpa-voice/scripts/agentic/teams/sherpa/recipes/`. Keep routine validation focused on representative mobile-sized models; reserve very large specialized models for targeted backend checks.

## Test Infrastructure Features

### Automated Model Downloads ✅
- Concurrent downloads with progress tracking
- Checksum validation for integrity
- Automatic retry with exponential backoff
- Efficient cache management

### Performance Profiling ✅  
- Memory usage tracking (before/after operations)
- Execution time benchmarking
- Device capability analysis
- CSV report generation for analysis

### Comprehensive Reporting ✅
- HTML reports with detailed metrics
- Success/failure tracking with timing data
- Memory leak detection results
- Performance trend analysis

## CI/CD Integration

### Tiered Testing Strategy

1. **Lightweight CI Tests** (<1 minute)
   - Architecture detection
   - Basic system info validation
   - No model downloads

2. **Development Tests** (<5 minutes)  
   - Lightweight model testing
   - Performance benchmarking
   - Memory management validation

3. **Full Integration Tests** (<30 minutes)
   - Complete model suite testing
   - Extended stability testing
   - Cross-platform parity validation

### Required Infrastructure

- **Android**: Connected device or emulator
- **iOS**: Xcode with simulator or device
- **Model Storage**: Cached lightweight models
- **Performance Monitoring**: Memory and CPU tracking tools

## Best Practices

### Test Development
1. Always test on real devices for accurate results
2. Include both success and failure scenarios
3. Validate memory management and cleanup
4. Test platform-specific features (Metal, Vulkan)
5. Document performance benchmarks and expectations

### Debugging Integration Issues
1. Check architecture detection first (`getArchitectureInfo()`)
2. Validate system capabilities (`getSystemInfo()`)
3. Monitor memory usage during model operations
4. Use platform-specific debugging tools (Xcode Instruments, Android Studio Profiler)

### Model Testing Strategy
1. Start with lightweight models for faster iteration
2. Test model lifecycle (init → use → cleanup)
3. Validate error handling with invalid inputs
4. Check concurrent usage scenarios
5. Monitor memory leaks during extended usage

## Known Limitations

### iOS Model Testing
- Real ONNX model tests require the target models to be present in the simulator or device sandbox before the bridge roundtrip runs
- The app download path and sideloaded-model path exercise the same ASR bridge after files are in place
- Heavy models can make reinstall/retry loops slow; reset app storage when download state becomes stale during manual validation

### Web Platform
- WASM runtime and ASR backends are implemented, but each release still needs browser smoke coverage for asset paths and hosted model URLs
- Very large specialized ASR models can be impractical on slow networks or constrained devices
- UI-level ASR model picker recipes can be flaky for models far down virtualized lists; bridge-level recipes are the stable coverage path

### CI/CD
- Requires physical device access for comprehensive testing
- Model downloads add time to test execution
- Platform-specific CI runners needed for complete coverage

## Future Enhancements

1. **iOS Model Integration**: Port Android model testing to iOS
2. **Web WASM Support**: Complete web platform implementation  
3. **Enhanced CI/CD**: Automated device testing with model caching
4. **Performance Regression Detection**: Automated performance monitoring
5. **Extended Model Testing**: Support for larger model suites
