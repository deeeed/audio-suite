# Native Integration Testing for sherpa-onnx.rn

## Purpose

This document guides agents in creating native integration tests for the sherpa-onnx.rn iOS and Android implementations. These tests validate that the C++ Sherpa-ONNX library works correctly when wrapped for React Native.

## The Basic Feedback Loop

```
1. Write Native Test → 2. Run on Device/Simulator → 3. Check Results
                                                          ↓
                                                   Pass? → Next Test
                                                   Fail? → Fix Native Code
```

## iOS Native Testing

### Test Structure
```
ios/
├── SherpaOnnxTests/
│   ├── BasicIntegrationTest.swift
│   ├── SystemInfoIntegrationTest.swift
│   ├── TtsIntegrationTests.swift
│   └── Info.plist
└── test_models/
    └── README.md          # models are downloaded, not committed
```

### First iOS Test

The shipped `BasicIntegrationTest.swift` is a placeholder: both of its tests assert
`true` and keep the real bodies commented out. `SherpaOnnxWrapper` and `TtsModelConfig`
do not exist, so the sketch below is what such a test would look like once they do, not
what runs today.

```swift
// Aspirational. Neither type exists yet.
import XCTest
@testable import SherpaOnnx

class BasicIntegrationTest: XCTestCase {
    
    func testLibraryLoads() {
        let loaded = SherpaOnnxWrapper.validateLibraryLoaded()
        XCTAssertTrue(loaded, "Sherpa-ONNX library should load")
    }
    
    func testTtsInitWithoutModel() {
        let config = TtsModelConfig(modelPath: "/invalid/path")
        
        do {
            _ = try SherpaOnnxWrapper.initializeTts(config: config)
            XCTFail("Should throw error for missing model")
        } catch {
            print("iOS Error for missing model: \(error)")
        }
    }
}
```

### Running iOS Tests

There is no iOS workspace or `SherpaOnnxTests` scheme in this package. The files under
`ios/SherpaOnnxTests/` are sources without an Xcode project to run them: they compile
only when a host app includes them. Running them needs a test target created first, in
the consuming app's workspace.

## Android Native Testing

### Test Structure
```
android/
├── src/
│   ├── androidTest/                      # instrumented, needs a device
│   │   └── java/net/siteed/sherpaonnx/
│   │       ├── BasicIntegrationTest.kt
│   │       ├── TtsIntegrationTest.kt
│   │       ├── RealAsrFunctionalityTest.kt
│   │       ├── RealTtsFunctionalityTest.kt
│   │       └── ...                        # see the directory for the full set
│   └── test/                              # JVM unit tests
│       ├── java/net/siteed/sherpaonnx/handlers/
│       │   ├── PrefillPolicyTest.kt
│       │   └── TtsHandlerWiringTest.kt
│       └── resources/README.md            # fixtures are downloaded, not committed
```

### First Android Test

```kotlin
// android/src/androidTest/java/net/siteed/sherpaonnx/BasicIntegrationTest.kt
package net.siteed.sherpaonnx

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.Assert.*

@RunWith(AndroidJUnit4::class)
class BasicIntegrationTest {
    
    @Test
    fun testLibraryLoads() {
        // Test 1: Can we load the JNI library?
        val loaded = SherpaOnnxModule.validateLibraryLoaded()
        assertTrue("Sherpa-ONNX library should load", loaded)
    }
    
    @Test
    fun testTtsInitWithoutModel() {
        // Test 2: Does it fail gracefully without model?
        try {
            SherpaOnnxModule.initializeTts("/invalid/path", "model.onnx")
            fail("Should throw exception for missing model")
        } catch (e: Exception) {
            // Expected - document the error
            println("Android Error for missing model: ${e.message}")
        }
    }
}
```

### Running Android Tests

```bash
# From android directory
cd android

# Run instrumented tests on connected device
(cd ../../apps/sherpa-voice/android && APP_VARIANT=development \
  ./gradlew :siteed_sherpa-onnx.rn:connectedAndroidTest)

# Run specific test
(cd ../../apps/sherpa-voice/android && APP_VARIANT=development \
  ./gradlew :siteed_sherpa-onnx.rn:connectedAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=net.siteed.sherpaonnx.BasicIntegrationTest)
```

## Key Native Tests to Implement

### Priority Order

1. **Library Loading**
   - C++ library loads
   - JNI methods accessible
   - Basic validation works

2. **Model Loading**
   - Invalid path handling
   - Valid model loading
   - Memory allocation

3. **TTS Operations**
   - Text to audio generation
   - File output validation
   - Audio format checking

4. **Memory Management**
   - Proper cleanup
   - No memory leaks
   - Multiple init/release cycles

5. **Thread Safety**
   - Concurrent operations
   - Background thread usage
   - Main thread requirements

## Platform Differences to Document

Keep a log of discovered differences:

```markdown
# Native Platform Differences

## iOS
- Requires .xcframework inclusion
- Uses CAF audio format
- NSTemporaryDirectory() for files

## Android
- Requires libc++_shared.so
- Uses WAV audio format
- getCacheDir() for files
```

## Example Test Session

```
1. Write test: "TTS generates audio file"
2. Run on iOS simulator
   Result: ✅ Pass - file at /tmp/sherpa_audio.caf
3. Run on Android emulator
   Result: ❌ Fail - "Permission denied"
4. Fix: Add WRITE_EXTERNAL_STORAGE permission
5. Run again on Android
   Result: ✅ Pass - file at /data/cache/sherpa_audio.wav
6. Document: Different audio formats and paths per platform
```

## Tips for Native Testing

1. **Start with simplest test** - Just load the library
2. **Use small test models** - Don't include full models in tests
3. **Test error cases first** - They reveal more about implementation
4. **Log everything** - Platform logs help debug native issues
5. **Test on real devices** - Simulators may behave differently

## Implementation Status ✅

The native integration testing framework has been implemented with the following components:

### iOS Test Structure ✅
- `ios/SherpaOnnxTests/BasicIntegrationTest.swift` - Basic library loading tests
- `ios/SherpaOnnxTests/TtsIntegrationTests.swift` - TTS-specific tests  
- `ios/SherpaOnnxTests/Info.plist` - Test bundle configuration
- `ios/test_models/` - Directory for test models with setup docs

### Android Test Structure ✅  
- `android/src/androidTest/java/net/siteed/sherpaonnx/BasicIntegrationTest.kt` - Basic library tests
- `android/src/androidTest/java/net/siteed/sherpaonnx/TtsIntegrationTest.kt` - TTS-specific tests
- `android/src/test/resources/` - Directory for test models with setup docs
- Updated `android/build.gradle` with test dependencies and instrumentation runner

### Test Execution ✅
- Android: `yarn test:android` - Runs comprehensive integration tests via gradle
- iOS: `yarn test:ios:info` - Provides guidance for manual testing due to platform limitations

### Documentation ✅
- `PLATFORM_DIFFERENCES.md` - Comprehensive platform comparison
- Updated `NATIVE_TEST_CHECKLIST.md` with implementation status
- README files in test directories explaining model setup

## Next Steps

1. **Add Actual sherpa-onnx Integration**: Replace test placeholders with real library calls
2. **Set up Test Models**: Download/generate small test models for validation  
3. **Create Xcode Test Target**: Add proper test target to iOS project for automated testing
4. **Run Initial Tests**: Execute `yarn test:android` to validate framework on Android
5. **Implement Real Validation**: Replace placeholder assertions with actual library validation

The testing framework is ready - now integrate with actual sherpa-onnx implementation! 