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

The shipped `BasicIntegrationTest.swift` is a placeholder: all three of its tests assert
`true` with the real bodies commented out. There is no example to copy here yet, because
the wrapper API those comments call has not been designed.

### Running iOS Tests

There is no iOS workspace or `SherpaOnnxTests` scheme in this package, and no way to run
these tests today. The files under `ios/SherpaOnnxTests/` are sources with no Xcode
project, and they would not build as they stand: `SystemInfoIntegrationTest.swift` uses
an initializer and method signatures that do not exist. Running them needs both a test
target in the consuming app's workspace and repairs to the sources themselves.

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

The checked-in `BasicIntegrationTest.kt` reaches the module by reflection rather than
calling it directly. `SherpaOnnxModule` is not a static object, `validateLibraryLoaded`
takes a `Promise`, and there is no `initializeTts`, so a direct call would not compile.

```kotlin
// android/src/androidTest/java/net/siteed/sherpaonnx/BasicIntegrationTest.kt
@RunWith(AndroidJUnit4::class)
class BasicIntegrationTest {

    @Test
    fun testSherpaOnnxModuleReflection() {
        val moduleClass = Class.forName("net.siteed.sherpaonnx.SherpaOnnxModule")
        assertNotNull("SherpaOnnxModule class should be available", moduleClass)

        val methodNames = moduleClass.declaredMethods.map { it.name }
        assertTrue("Should have initTts method", methodNames.contains("initTts"))
        assertTrue("Should have validateLibraryLoaded method",
            methodNames.contains("validateLibraryLoaded"))
    }
}
```

### Running Android Tests

```bash
# Run from packages/sherpa-onnx.rn. Each command cds to the host app itself.

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
- Links vendored static `.a` libraries via the podspec's `vendored_libraries`, not an
  xcframework
- Writes `.wav`
- TTS writes into `.cachesDirectory`; denoising uses `NSTemporaryDirectory()`

## Android
- Requires libc++_shared.so
- Uses WAV audio format
- getCacheDir() for files
```

## Example Test Session

```
1. Write test: "TTS generates audio file"
2. Run on iOS simulator
   Result: ✅ Pass - file at <caches>/sherpa_audio.wav
3. Run on Android emulator
   Result: ❌ Fail - "Permission denied"
4. Fix: Add WRITE_EXTERNAL_STORAGE permission
5. Run again on Android
   Result: ✅ Pass - file at /data/cache/sherpa_audio.wav
6. Document: both platforms write WAV; only the output directory differs
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

### Test Execution
- Android: `yarn test:android` - wired to gradle, but the suites currently fail to run (#475)
- iOS: `yarn test:ios:info` - prints guidance only; there is no XCTest target to run

### Documentation ✅
- `platform-differences.md` - platform comparison
- `test-checklist.md` - implementation status
- README files in test directories explaining model setup

## Next Steps

1. **Add Actual sherpa-onnx Integration**: Replace test placeholders with real library calls
2. **Set up Test Models**: Download/generate small test models for validation  
3. **Create Xcode Test Target**: Add proper test target to iOS project for automated testing
4. **Run Initial Tests**: Execute `yarn test:android` to validate framework on Android
5. **Implement Real Validation**: Replace placeholder assertions with actual library validation

The testing framework is ready - now integrate with actual sherpa-onnx implementation! 