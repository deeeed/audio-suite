# Integration Test Model Management Strategy

## Overview

This document outlines the model management strategy for integration testing the sherpa-onnx.rn React Native package. The strategy is based on analysis of the sherpa-voice app's sophisticated model management system.

## Model Categories for Testing

### 1. Lightweight Models (CI Testing < 100MB Total)

These models are suitable for continuous integration testing where download time and storage are limited:

| Model ID | Name | Type | Size | Purpose |
|----------|------|------|------|---------|
| `vits-icefall-en-low` | VITS Icefall English (Low Quality) | TTS | ~30MB | Basic text-to-speech functionality |
| `silero-vad` | Silero VAD | VAD | ~0.6MB | Voice activity detection |
| `ced-tiny` | CED Tiny Audio Tagging | Audio Tagging | ~27MB | Basic audio classification |
| `kws-zipformer` | KWS Zipformer | Keyword Spotting | 14.9MB | Keyword detection |

**Total: 58.1 MiB for the first three rows** (measured from content-length:
31722013 + 643854 + 28531989 bytes). `kws-zipformer` has no downloader entry; including
its listed 14.9MB is how this table used to reach ~72MB. The downloader enum itself has
four entries, the fourth being `WHISPER_TINY`, which this table does not list.

The Model ID column is a local identifier only. It is neither the upstream archive name
nor the directory the archive extracts into, and all three differ for several of these:
`vits-icefall-en-low` downloads `vits-icefall-en_US-ljspeech-low.tar.bz2` and extracts
`vits-icefall-en_US-ljspeech-low/`. Assuming they matched is what broke the instrumented
tests in #458. Download URLs for the
first three live in `LightweightModelDownloader.kt`; `kws-zipformer` has no entry there
and is not downloaded by that path.

### 2. Development Models (< 500MB Total)

Extended model set for development and feature testing:

- All lightweight models above
- `vits-piper-medium` (64.1MB) - Quality TTS
- `streaming-zipformer-mobile` (103MB) - Real-time ASR
- `whisper-tiny` (113MB) - Offline ASR  
- `speaker-id-english` (28.2MB) - Speaker verification

**Total Size: ~382MB**

### 3. Full Test Suite (< 1.5GB Total)

Comprehensive testing with larger, production-quality models:

- All development models above
- `matcha-icefall` + Vocoder (79MB total) - Modern TTS
- `streaming-zipformer-general` (296MB) - Full ASR
- `whisper-small` (610MB) - Multilingual ASR

## Testing Approach

### Phase 1: Model Configuration Testing

Tests model metadata, configuration generation, and file structure without requiring actual model files:

```kotlin
// Test model registry and configurations
fun testLightweightModelRegistry() 
fun testTtsConfigurationGeneration()
fun testMultiModelTypeSupport()
```

**Benefits:**
- Fast execution (< 1 second)
- No network dependencies
- Validates configuration logic
- Suitable for all CI environments

### Phase 2: Model Simulation Testing

Tests model download simulation, extraction validation, and file system operations:

```kotlin
// Test model management workflows
fun testTtsModelDirectoryStructure()
fun testArchiveExtractionSimulation() 
fun testModelValidation()
```

**Benefits:**
- Validates file operations
- Tests Android-specific paths
- No actual model downloads
- Verifies extraction logic

### Phase 3: Native Integration Testing

Tests native library integration and actual model functionality (when models are available):

```kotlin
// Test native functionality
fun testNativeLibraryIntegration()
fun testModelInitializationFlow()
```

**Benefits:**
- Validates complete pipeline
- Tests actual sherpa-onnx integration
- Confirms native library loading
- Real functionality validation

## Model Management Strategy

### Local Development

For local development and testing:

1. **Manual Model Download**: Developers can manually download lightweight models
2. **Shared Cache**: Use common cache directory for models across projects
3. **Environment Variable**: `SHERPA_ONNX_MODELS_DIR` to specify model location

### CI/CD Integration

For automated testing:

1. **Mock Testing**: Use model metadata and configuration testing (Phase 1)
2. **Simulation Testing**: Use file system simulation without actual downloads (Phase 2)
3. **Optional Downloads**: Optionally download lightweight models for full validation
4. **Caching**: Cache downloaded models between CI runs

### Model Storage Locations

Following the sherpa-voice pattern:

```
Models Directory Structure:
├── models/
│   ├── tts/
│   │   └── vits-icefall-en-low/
│   │       ├── model.onnx
│   │       ├── tokens.txt
│   │       └── lexicon.txt
│   ├── vad/
│   │   └── silero-vad/
│   │       └── silero_vad.onnx
│   └── audio-tagging/
│       └── ced-tiny/
│           ├── model.onnx
│           └── labels.txt
```

**Storage Paths:**
- **Android**: `${context.filesDir}/models/${type}/${id}`  
- **iOS**: `${FileManager.documentDirectory}/models/${type}/${id}`
- **Web**: IndexedDB virtual paths

## Implementation Guidelines

### Test Organization

1. **Unit Tests**: Model configuration and metadata validation
2. **Integration Tests**: Native library and functionality testing
3. **E2E Tests**: Complete workflow testing with real models

### Model Registry Format

This is the test registry entry, not the config `TtsHandler` consumes. The handler takes
`modelDir` plus `modelFile`, `tokensFile` and `lexiconFile` — a directory and filenames,
not full paths.

```kotlin
val modelConfig = mapOf(
    "id" to "vits-icefall-en-low",
    "name" to "VITS Icefall English (Low Quality)",
    "type" to "tts",
    "size" to 30 * 1024 * 1024,
    "files" to listOf("model.onnx", "tokens.txt", "lexicon.txt"),
    "ttsModelType" to "vits",
    "provider" to "cpu",
    "url" to "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-icefall-en_US-ljspeech-low.tar.bz2"
)
```

### Error Handling

- **Missing Models**: Graceful degradation to simulation mode
- **Download Failures**: Retry logic with exponential backoff  
- **Extraction Errors**: Partial cleanup and error reporting
- **Native Library Issues**: Clear error messages with troubleshooting steps

## Benefits of This Strategy

1. **Scalable Testing**: Start with lightweight, progress to comprehensive
2. **CI-Friendly**: Fast tests that don't require large downloads
3. **Realistic Validation**: Tests actual model configurations and workflows
4. **Production-Ready**: Based on proven sherpa-voice architecture
5. **Cross-Platform**: Consistent approach across Android, iOS, and Web
6. **Maintainable**: Clear separation between simulation and real testing

## Future Enhancements

1. **Model Version Management**: Support for model versioning and updates
2. **Automatic Model Discovery**: Dynamic model registry updates
3. **Performance Benchmarking**: Model loading and inference timing
4. **Memory Usage Analysis**: Model memory footprint testing
5. **Platform Optimization**: Platform-specific model optimization testing

This strategy provides a robust foundation for testing sherpa-onnx.rn functionality while being practical for both development and CI/CD environments.