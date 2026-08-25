# Android Implementation for @siteed/sherpa-onnx.rn

This directory contains the Android native implementation for the Sherpa ONNX React Native module.

## Architecture

The implementation consists of:

1. **Kotlin Native Module** (`SherpaOnnxModule.kt`): React Native module implementation that loads the Sherpa ONNX JNI library and bridges the JavaScript API to native handlers.

2. **JNI Libraries** (in `src/main/jniLibs/`): Native `.so` libraries for different architectures that implement the actual speech recognition functionality.

3. **New Architecture Compatibility**: React Native codegen and the package TurboModule spec provide the bridge surface for New Architecture apps.

## Building the Module

The npm package normally uses downloaded prebuilts. Local development can rebuild the native libraries with the package scripts:

1. **setup.sh**: Clones the Sherpa ONNX repository into `third_party/`.

2. **build-sherpa-android.sh**: Builds the Sherpa ONNX native libraries for Android using the Sherpa ONNX build scripts.

3. **install.js**: Downloads published prebuilts during package installation when they are missing.

## Build Process

For a local rebuild:

1. Run `yarn setup` to clone the Sherpa ONNX repository and apply wrapper patches.
2. Run `yarn build:android` to build the Sherpa ONNX native libraries.
3. Rebuild the consuming Android app.

For install-time Android rebuilds, set `SITEED_SHERPA_ONNX_REBUILD_ANDROID=1`. If the package install cannot download prebuilts, the install script logs the failure and leaves the app install alive so developers can build manually.

## Compatibility with React Native

The module supports both the Old and New React Native architectures:

- **Old Architecture**: Uses the Kotlin bridge implementation.
- **New Architecture**: Uses the generated TurboModule spec and compatible native bridge.

## Speech Recognition Backends

The Android bridge supports the ASR backends exposed through `AsrModelConfig`, including transducer/Zipformer, Whisper, Moonshine, SenseVoice, Qwen3-ASR, and other upstream sherpa-onnx backends.

Qwen3 model directories must include `conv_frontend.onnx`, `encoder.int8.onnx`, `decoder.int8.onnx`, and the tokenizer directory. Specialized large-model backends may require additional sidecar files; keep those as targeted validations rather than default mobile smoke tests.

Build success is not the same as runtime ASR validation. Runtime validation means launching an app on a device/emulator with the target model present and running an ASR roundtrip, for example through the `apps/sherpa-voice` agentic recipes.

## JVM Compatibility

The module is configured to use Java 17, which is required for modern React Native applications. This is set in the `build.gradle` file:

```gradle
compileOptions {
    sourceCompatibility JavaVersion.VERSION_17
    targetCompatibility JavaVersion.VERSION_17
}

kotlinOptions {
    jvmTarget = '17'
}
```

## Troubleshooting

### Missing JNI Libraries
If you encounter errors about missing native libraries, make sure you've run:
```
yarn setup
yarn build:android
```

### New Architecture Compatibility
If you have build errors in a New Architecture app, check that:
1. Codegen has run for the consuming app.
2. Your app's Gradle and React Native versions are compatible with the module's configuration.

### ONNX Runtime coexistence

Moonshine's default Android artifact uses the private
`libmoonshine_onnxruntime.so` SONAME. Sherpa keeps `libonnxruntime.so`, so both
engines can load their matching runtime without a duplicate-library
`pickFirst` rule. See [Android ONNX Runtime coexistence](../../../docs/ANDROID_ORT_ALIGNMENT.md).
