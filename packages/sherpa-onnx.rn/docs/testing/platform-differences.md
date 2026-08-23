# Native Platform Differences

This document tracks discovered differences between iOS and Android implementations during native integration testing.

## File System & Paths

### iOS
- TTS writes into `.cachesDirectory`; denoising uses `NSTemporaryDirectory()`
- Audio files saved as `.wav`, not CAF
- Model files can be bundled in app bundle
- Path example: `/var/mobile/.../Library/Caches/sherpa_audio.wav`

### Android
- Uses Context.getCacheDir() for temporary files  
- Audio files typically saved as .wav format
- Model files extracted from assets to cache directory
- Path example: `/data/data/com.app/cache/sherpa_audio.wav`

## Library Loading

### iOS
- Links vendored static `.a` libraries via the podspec's `vendored_libraries`
- Static libraries linked at build time
- Framework must be added to test targets separately

### Android
- Requires libc++_shared.so and JNI libraries
- Dynamic loading through System.loadLibrary()
- Gradle manages library inclusion in APK

## Audio Formats

### iOS
- Writes WAV. `SherpaOnnxTtsHandler.swift` saves `<name>.wav` into `.cachesDirectory`,
  and the denoising handler writes `.wav` under `NSTemporaryDirectory()`
- No CAF anywhere in the implementation, despite what this document used to claim

### Android
- Primarily uses WAV format
- Uses `AudioTrack` for playback; no `MediaRecorder` in the implementation
- Limited native audio format support

## Memory Management

### iOS
- Automatic Reference Counting (ARC) for Swift/Objective-C
- Manual memory management needed for C++ objects
- Memory warnings handled by iOS system

### Android
- Garbage collection for Java/Kotlin objects
- Manual memory management for JNI/C++ objects
- OutOfMemoryError handling required

## Threading

### iOS
- Main thread requirements for UI updates
- Background queues for audio processing
- GCD (Grand Central Dispatch) for concurrency

### Android
- Main/UI thread restrictions
- Background threads for heavy processing
- `Executors` for concurrency; `AsyncTask` is not used

## Error Handling

### iOS
- NSError for Objective-C APIs
- Swift Error protocol for Swift APIs
- Exception handling through do-catch

### Android
- Java exceptions propagated through JNI
- Kotlin exception handling
- Native crashes harder to debug

## Testing Differences

### iOS
- XCTest framework for unit/integration tests
- Requires Xcode for GUI-based testing
- Simulator testing available

### Android
- JUnit for unit tests
- Instrumented tests for integration testing
- Emulator/device testing through Gradle

## Build System

### iOS
- Xcode project/workspace files
- CocoaPods for dependency management
- xcodebuild for command-line builds

### Android
- Gradle build system
- Maven dependencies
- Command-line builds supported

## Permissions

### iOS
- Info.plist for permissions
- Runtime permission requests
- Privacy usage descriptions required

### Android
- AndroidManifest.xml for permissions
- Runtime permissions (API 23+)
- Permission groups and dangerous permissions

## Model Loading Performance

### iOS
- Bundle resources loaded synchronously
- Metal framework for GPU acceleration
- CoreML integration possible

### Android
- Asset extraction adds loading time
- OpenCL for GPU acceleration
- NNAPI integration possible

## Discovered Issues

### Non-issue: Audio Format Compatibility
Both platforms write WAV, so there is no format mismatch. This section previously
described a CAF-versus-WAV problem that the implementation never had.

### Issue: File Path Separators
- **iOS**: Uses forward slashes (Unix-style)
- **Android**: Uses forward slashes (Linux-style)
- **Solution**: Both use forward slashes, no issues found

### Issue: Model File Size Limits
- **iOS**: Bundle size affects app store submission
- **Android**: APK size affects download/install time
- **Solution**: Download models on first run rather than bundling

## Test Execution Notes

Android's instrumented suite runs on a connected device from the generated sherpa-voice
project. iOS has no XCTest target. The notes below describe each platform's requirements.

### iOS Testing
- Requires macOS with Xcode installed
- Simulator tests may behave differently than device tests
- Command-line testing possible but limited

### Android Testing
- Works on any platform with Android SDK
- Emulator/device tests via ADB
- Full command-line automation supported

## Recommendations

1. **Use WAV format** for audio files for maximum compatibility
2. **Download models** rather than bundling to reduce app size
3. **Test on real devices** whenever possible, not just simulators/emulators
4. **Handle threading carefully** - both platforms have main thread restrictions
5. **Implement proper error handling** for platform-specific failure modes
6. **Use platform-appropriate** temporary directories and file paths

## Future Considerations

- WebAssembly (WASM) implementation for web platform
- Desktop support (macOS app, Windows)
- Cross-compilation considerations for different architectures
