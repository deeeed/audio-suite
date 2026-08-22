# Contributing to @siteed/expo-audio-studio

Thank you for your interest in contributing to this library! This document provides comprehensive guidelines for contributing using our **Agentic Framework** for 10x productivity gains.

## Table of Contents

- [Agentic Framework Philosophy](#agentic-framework-philosophy)
- [Feature Development Process](#feature-development-process)
- [Validation Workflows](#validation-workflows)
- [Platform Implementation Order](#platform-implementation-order)
- [Development Setup](#development-setup)
- [Debugging](#debugging)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)
- [Release Process](#release-process)

## Development Approaches

This project supports two development approaches - choose the one that best fits your workflow:

### 🤖 Agentic Framework (Recommended for AI-Assisted Development)

For those using AI agents or seeking 10x productivity gains through automated feedback loops:

**Core Philosophy:**
- **Fast validation** (< 2 minutes to prove functionality works)
- **Real device testing** instead of mocked behavior
- **Automated feedback loops** as the key to productivity
- **Quality assurance** that prevents team regressions

**Quick Commands:**
```bash
cd apps/playground
scripts/agentic/start-metro.sh                                            # Start Metro
# Recording via CDP must be fire-and-store: an eval that leaves a recording promise outstanding as audio starts
# flowing crashes the app (#436). See CLAUDE.md "Recording via CDP".
scripts/agentic/app-state.sh eval "(() => { globalThis.__V = {}; setTimeout(async () => { try { const r = await __AGENTIC__.startRecording({ sampleRate: 44100, channels: 1 }); if (r && r.error) { globalThis.__V = { err: r.error }; return } await new Promise(r2 => setTimeout(r2, 3000)); const s = await __AGENTIC__.stopRecording(); globalThis.__V = (s && s.error) ? { err: s.error } : { uri: s.fileUri, size: s.size, dur: s.durationMs } } catch (e) { globalThis.__V = { err: String(e) } } }, 1500); return 'scheduled' })()"
sleep 10
scripts/agentic/app-state.sh eval "JSON.stringify(globalThis.__V)"
scripts/agentic/app-state.sh state                                        # Check state
```

**Agent Constraints:**
- NEVER IMPLEMENT UNLESS ASKED
- ALWAYS VERIFY IN SOURCE CODE
- MINIMIZE DIFF - smallest possible changes
- NO WORKAROUNDS - fix root causes
- REAL TESTING ONLY - no simulated results

### 🧪 Traditional TDD (Alternative Approach)

For those preferring traditional test-driven development:

**Core Philosophy:**
- Write tests first to define expected behavior
- Red → Green → Refactor cycle
- High test coverage and living documentation
- Cross-platform consistency through comprehensive testing

**Quick Commands:**
```bash
# Run traditional test suite
./scripts/run_tests.sh all     # All platforms
./scripts/run_tests.sh android # Android only
./scripts/run_tests.sh ios     # iOS only
```

**TDD Workflow:**
1. Write failing tests first
2. Implement minimal code to pass
3. Refactor while keeping tests green
4. Validate on all platforms

Both approaches ensure high-quality, cross-platform consistent features. Choose based on your development style and tooling preferences.

## Feature Development Process

### Step 1: Architecture Design

Before writing any code:

1. **Define the Feature Goal**
   - What problem does this solve?
   - Who will use this feature?
   - What are the success criteria?

2. **Design the API**
   ```typescript
   // Example: New audio feature API design
   interface AudioFeatureConfig {
     sampleRate?: number;
     windowSize?: number;
     hopLength?: number;
   }
   
   interface AudioFeatureResult {
     timestamp: number;
     value: number;
     confidence?: number;
   }
   
   // Define the public API
   function extractAudioFeature(
     audioData: Float32Array,
     config?: AudioFeatureConfig
   ): AudioFeatureResult[];
   ```

3. **Create Architecture Document**
   - Create a design doc in `docs/architecture/FEATURE_NAME.md`
   - Include API design, data flow, and platform considerations
   - Get review and approval before proceeding

### Step 2: Test Specification (Recommended)

Creating comprehensive test specifications helps ensure robust implementations:

1. **Create Test Plan**
   ```markdown
   # Test Plan: [Feature Name]
   
   ## Unit Tests
   - [ ] Basic functionality with default parameters
   - [ ] Custom configuration handling
   - [ ] Edge cases (empty data, invalid params)
   - [ ] Error scenarios
   
   ## Integration Tests
   - [ ] Works with audio recording
   - [ ] Works with file processing
   - [ ] Performance benchmarks
   
   ## Platform Tests
   - [ ] iOS implementation matches spec
   - [ ] Android implementation matches spec
   - [ ] Web implementation matches spec
   ```

2. **Write Test Cases First (When Possible)**
   ```typescript
   // Example test file: __tests__/audioFeature.test.ts
   describe('AudioFeature', () => {
     it('should extract features from audio data', () => {
       const audioData = generateTestTone(440, 1.0); // 440Hz, 1 second
       const features = extractAudioFeature(audioData);
       
       expect(features).toHaveLength(43); // 1 second at default hop
       expect(features[0].timestamp).toBe(0);
       expect(features[0].value).toBeCloseTo(0.5, 2);
     });
     
     it('should handle empty audio data', () => {
       const features = extractAudioFeature(new Float32Array(0));
       expect(features).toEqual([]);
     });
     
     // More test cases...
   });
   ```

### Step 3: Implementation Order

Follow this recommended implementation order:

#### 1. TypeScript Interface (Shared)
```typescript
// src/types/AudioFeature.ts
export interface AudioFeatureExtractor {
  extract(audioData: Float32Array, config?: AudioFeatureConfig): AudioFeatureResult[];
  getName(): string;
  getDefaultConfig(): AudioFeatureConfig;
}
```

#### 2. iOS Implementation
```swift
// ios/AudioFeatureExtractor.swift
class AudioFeatureExtractor {
    func extract(audioData: [Float], config: AudioFeatureConfig?) -> [AudioFeatureResult] {
        // Implementation
    }
}
```

**Validation**: Run iOS tests
```bash
cd packages/audio-studio
./scripts/run_tests.sh ios
```

#### 3. Android Implementation
```kotlin
// android/src/main/java/net/siteed/audiostudio/AudioFeatureExtractor.kt
class AudioFeatureExtractor {
    fun extract(audioData: FloatArray, config: AudioFeatureConfig?): List<AudioFeatureResult> {
        // Implementation
    }
}
```

**Validation**: Run Android tests
```bash
cd packages/audio-studio
./scripts/run_tests.sh android
```

#### 4. Web Implementation (if applicable)
```typescript
// src/web/AudioFeatureExtractor.ts
export class AudioFeatureExtractor {
  extract(audioData: Float32Array, config?: AudioFeatureConfig): AudioFeatureResult[] {
    // Implementation using Web Audio API
  }
}
```

#### 5. Integration Testing
Run cross-platform tests to ensure consistency:
```bash
cd packages/audio-studio
yarn test:integration
```

#### 6. Update Playground App

**MANDATORY**: Update the playground app to demonstrate the new feature:

```bash
cd apps/playground
```

Required updates:
1. **Add UI controls** in the appropriate settings screen
2. **Show feature in action** with real examples
3. **Display platform limitations** discovered during testing
4. **Include performance metrics** if relevant

Example additions for a new feature:
```typescript
// In RecordingSettings.tsx or appropriate component
<SettingsSection title="Buffer Configuration">
  <Slider
    label="Buffer Duration"
    value={config.bufferDurationSeconds}
    onValueChange={(value) => updateConfig({ bufferDurationSeconds: value })}
    minimumValue={0.01}
    maximumValue={0.5}
  />
  {Platform.OS === 'ios' && (
    <Text style={styles.warning}>
      Note: iOS enforces minimum 0.1s buffer size
    </Text>
  )}
</SettingsSection>

// Add toggle for skip file writing
<Switch
  label="Skip File Writing (Streaming Only)"
  value={config.skipFileWriting}
  onValueChange={(value) => updateConfig({ skipFileWriting: value })}
/>
```

## Validation Workflows

Choose the validation approach that fits your development style:

### CDP Bridge Validation Workflow (Fast & Modern)

For AI-assisted development with fast feedback loops:

```bash
# 1. Create feature branch
git checkout -b feature/audio-pitch-detection

# 2. Implement feature

# 3. Start Metro and navigate to test screen
cd apps/playground
scripts/agentic/start-metro.sh
scripts/agentic/app-navigate.sh "/(tabs)/record"

# 4. Validate via CDP bridge (< 2 minutes)
#    Recording must be fire-and-store — an eval that leaves a recording promise outstanding as audio starts
#    flowing crashes the app (#436). See CLAUDE.md "Recording via CDP".
scripts/agentic/app-state.sh eval "(() => { globalThis.__V = {}; setTimeout(async () => { try { const r = await __AGENTIC__.startRecording({ sampleRate: 44100, channels: 1 }); if (r && r.error) { globalThis.__V = { err: r.error }; return } await new Promise(r2 => setTimeout(r2, 3000)); const s = await __AGENTIC__.stopRecording(); globalThis.__V = (s && s.error) ? { err: s.error } : { uri: s.fileUri, size: s.size, dur: s.durationMs } } catch (e) { globalThis.__V = { err: String(e) } } }, 1500); return 'scheduled' })()"
sleep 10
scripts/agentic/app-state.sh state
scripts/agentic/app-state.sh eval "JSON.stringify(globalThis.__V)"
scripts/agentic/screenshot.sh validation-result

# 5. Optional: Run E2E tests
yarn e2e:android:agent-validation
yarn e2e:ios:agent-validation
```

**Benefits:**
- Validates real functionality on actual devices
- Immediate feedback (< 2 minutes)
- No test maintenance overhead
- Discovers platform limitations immediately

### 🧪 Traditional TDD Workflow (Comprehensive Testing)

For traditional test-driven development:

```bash
# 1. Create feature branch  
git checkout -b feature/audio-pitch-detection

# 2. Write test first (TDD approach)
touch src/__tests__/pitchDetection.test.ts
# Write failing tests

# 3. Run tests (should fail)
yarn test

# 4. Implement for iOS
# Edit ios/PitchDetector.swift
./scripts/run_tests.sh ios

# 5. Implement for Android  
# Edit android/src/main/java/.../PitchDetector.kt
./scripts/run_tests.sh android

# 6. Ensure all tests pass
./scripts/run_tests.sh all

# 7. Add integration tests
# Edit e2e/pitchDetection.e2e.ts

# 8. Run full test suite
yarn test:all
```

**Benefits:**
- Comprehensive test coverage
- Living documentation through tests
- Detailed error scenario testing
- Traditional development comfort

## Testing Architecture

### Test Categories

1. **Unit Tests**
   - Pure logic without platform dependencies
   - Fast, isolated tests
   - Location: `src/__tests__/`

2. **Platform Tests**
   - iOS: `ios/AudioStudioTests/`
   - Android: `android/src/test/` (unit) and `android/src/androidTest/` (instrumented)
   - Test native implementations

3. **Integration Tests**
   - End-to-end feature tests
   - Cross-platform consistency tests
   - Location: `e2e/`

### Quick Test Commands

```bash
./scripts/run_tests.sh              # All platforms
./scripts/run_tests.sh android      # Android only  
./scripts/run_tests.sh ios          # iOS only
```

## Development Setup

### Prerequisites

1. **Environment Setup**
   ```bash
   # Install dependencies
   yarn install
   
   # Build the module
   yarn build
   
   # Prepare test environment
   yarn test:prepare
   ```

2. **Platform-Specific Setup**
   - **iOS**: Xcode 14+ with Swift 5.7+
   - **Android**: Android Studio with Kotlin 1.8+
   - **Web**: Node.js 18+ with TypeScript 5+

### Test Data

Test audio files are located in `test-assets/`:
- `jfk.wav` - Speech sample (mono, 16kHz)
- `chorus.wav` - Music sample (stereo, 44.1kHz)
- `tone_440hz.wav` - Pure tone for frequency tests

## Debugging

### Quick Debug Commands

**Android**
```bash
adb logcat -v time | grep "ExpoAudioStudio"        # Module logs
adb logcat -v time | grep "ExpoAudioStudio" | grep " E "  # Errors only
```

**iOS**
```bash
# Simulator
xcrun simctl spawn booted log stream --predicate 'process contains "AudioDevPlayground"'

# Device
log stream --predicate 'process contains "AudioDevPlayground"'
```

**Visual Tools**: Xcode Console app or macOS Console.app

## Code Style

### General Guidelines

1. **TypeScript/JavaScript**
   - Use functional programming patterns
   - Prefer interfaces over types
   - No enums, use const objects
   - Comprehensive JSDoc comments

2. **Kotlin (Android)**
   - Follow Kotlin coding conventions
   - Use coroutines for async operations
   - Prefer data classes for models

3. **Swift (iOS)**
   - Follow Swift API design guidelines
   - Use async/await for async operations
   - Prefer structs over classes when possible

### Testing Standards

1. **Test Naming**
   ```typescript
   // Good
   it('should extract MFCC features from mono audio at 16kHz', () => {});
   
   // Bad
   it('test mfcc', () => {});
   ```

2. **Test Structure**
   - Arrange: Set up test data
   - Act: Execute the function
   - Assert: Verify the result

3. **Test Coverage Goals**
   - Target 80% coverage for new features
   - Aim for 100% coverage for critical paths
   - Include edge cases and error scenarios

## Pull Request Process

### MANDATORY: Platform Compilation Verification

**All pull requests involving native code changes MUST verify that the code compiles on the target platforms.** This includes:

1. **Swift Code Changes (iOS)**
   - Verify compilation using Xcode or command line
   - Check for scope errors, undefined variables, and type mismatches
   - Run: `cd apps/playground && yarn ios --build-only` or similar

2. **Kotlin Code Changes (Android)**
   - Verify compilation using Android Studio or Gradle
   - Check for compilation errors and lint warnings
   - Run: `cd apps/playground && yarn android --build-only` or similar

3. **Integration Test Compilation**
   - Ensure tests compile and run without errors
   - Verify test imports and dependencies are correct

**Common Issues to Watch For:**
- Variable scope errors (accessing variables outside their scope)
- Missing imports or undefined symbols
- Type mismatches between platforms
- Changes that compile but would fail at runtime

**Example of a scope error that should be caught:**
```swift
// WRONG: compressedURL is out of scope
if let compressedURL = compressedFileURL {
  // compressedURL is only available inside this block
}
let filename = compressedURL?.lastPathComponent // ❌ Compilation error

// CORRECT: Use the class property
let filename = compressedFileURL?.lastPathComponent // ✅ Compiles correctly
```

### MANDATORY: Integration Tests for New Features

**All new features MUST include integration tests that validate ACTUAL platform behavior.** See [PR_METHODOLOGY.md](../../docs/PR_METHODOLOGY.md) for detailed requirements.

Integration tests are critical because they:
- Reveal undocumented platform limitations (e.g., iOS minimum buffer sizes)
- Validate actual behavior, not mocked behavior
- Ensure cross-platform consistency
- Serve as living documentation

Example from the buffer duration feature:
```swift
// Integration test discovered iOS enforces minimum 4800 frames
// This critical limitation would have been missed by unit tests
```

### Before Submitting

1. **Verify Platform Compilation (MANDATORY for native code changes)**
   ```bash
   # For iOS changes - verify Swift compilation
   cd apps/playground && yarn ios --build-only
   
   # For Android changes - verify Kotlin compilation  
   cd apps/playground && yarn android --build-only
   
   # Alternative: Build through Xcode/Android Studio
   ```

2. **Run Full Test Suite**
   ```bash
   yarn test:all
   yarn lint
   yarn format:check
   ```

3. **Update Documentation**
   - Update API documentation
   - Update test plan if needed
   - Add usage examples

4. **Self Review Checklist**
   - [ ] **Native code compiles successfully on target platforms**
   - [ ] No scope errors or undefined variables
   - [ ] All tests pass on all platforms
   - [ ] New features have tests (highly recommended)
   - [ ] API changes are documented
   - [ ] Breaking changes are noted
   - [ ] Performance impact is measured

### PR Template

```markdown
## Description
Brief description of the feature/fix

## Platform Compilation Verification (MANDATORY for native code changes)
- [ ] **iOS compilation verified** (Swift code compiles without errors)
- [ ] **Android compilation verified** (Kotlin code compiles without errors)
- [ ] No scope errors or undefined variables
- [ ] Tested with: `cd apps/playground && yarn ios --build-only` (or equivalent)

## Integration Tests
- [ ] **MANDATORY for new features**: Integration tests that validate ACTUAL platform behavior
- [ ] Tests reveal any platform limitations (document them!)
- [ ] iOS integration tests pass
- [ ] Android integration tests pass
- [ ] Test results included below

## Test Results
```
# Paste integration test output here
# Example: iOS buffer duration test revealed 4800 frame minimum
```

## Architecture Decision
Link to design doc or explain architectural choices

## Testing
- [ ] Unit tests added/updated
- [ ] Platform tests pass (iOS/Android/Web)
- [ ] Cross-platform consistency verified

## Documentation
- [ ] Updated EXISTING docs (don't create new files for config options)
- [ ] Added examples to relevant guides
- [ ] Platform-specific behavior documented

## Checklist
- [ ] **Platform compilation verified** (iOS/Android)
- [ ] Integration tests REQUIRED for features
- [ ] Minimal file changes
- [ ] No unnecessary subdirectories
- [ ] Breaking changes documented
- [ ] Follows code style guidelines
- [ ] Playground app updated with new feature
```

## Release Process

### Version Management

Semantic versioning is used:
- **Major**: Breaking API changes
- **Minor**: New features (backward compatible)
- **Patch**: Bug fixes

### Release Checklist

1. **Pre-release**
   - [ ] All tests pass
   - [ ] Documentation updated
   - [ ] CHANGELOG.md updated
   - [ ] Version bumped

2. **Testing**
   - [ ] Run on iOS device
   - [ ] Run on Android device
   - [ ] Test in playground app
   - [ ] Performance benchmarks

3. **Release**
   ```bash
   yarn release:prepare
   yarn release:publish
   ```

## Common Patterns

### Adding a New Audio Feature

1. **Design Phase**
   ```typescript
   // 1. Define types in src/types/
   interface NewFeatureConfig { /* ... */ }
   interface NewFeatureResult { /* ... */ }
   ```

2. **Test Phase (Recommended)**
   ```typescript
   // 2. Write tests in src/__tests__/
   describe('NewFeature', () => {
     // Test cases
   });
   ```

3. **Implementation Phase**
   ```kotlin
   // 3. Android: android/src/main/java/.../NewFeature.kt
   class NewFeature { /* ... */ }
   ```
   
   ```swift
   // 4. iOS: ios/NewFeature.swift
   class NewFeature { /* ... */ }
   ```

4. **Integration Phase**
   ```typescript
   // 5. Expose in module API
   export function processNewFeature(/* ... */) { /* ... */ }
   ```

### Testing Platform-Specific Code

```typescript
// Test both platforms produce same results
it('should produce consistent results across platforms', async () => {
  const audioData = loadTestAudio('test.wav');
  
  const iosResult = await runIosImplementation(audioData);
  const androidResult = await runAndroidImplementation(audioData);
  
  expect(iosResult).toEqual(androidResult);
});
```

## Getting Help

- **Documentation**: Check `docs/` folder
- **Examples**: See playground app
- **Issues**: GitHub issues for bugs/features
- **Discussions**: GitHub discussions for questions

**Note**: The testing framework is continuously improving. Contributors are encouraged to help expand test coverage and improve testing practices as the project evolves. 