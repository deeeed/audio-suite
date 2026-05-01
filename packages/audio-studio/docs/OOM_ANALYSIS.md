# OutOfMemoryError Analysis - AudioRecorderManager

## Issue Summary
The Android AudioRecorderManager was experiencing OutOfMemoryError crashes during long recordings due to unbounded memory growth in audio data accumulation buffers.

### Update (2024-08-02): Native Memory Leak Investigation
A separate native memory leak was discovered growing at ~2-3MB/s during recording with visualization enabled. Through systematic testing:
- With processing/visualization disabled: Memory stable (~117KB/s growth, matching audio data rate)
- With processing/visualization enabled: Memory grows at 2-3MB/s (20x expected rate)
- Thread count remains stable in both cases
- Base64 encoding and event emission are NOT the cause

## Root Cause Analysis

### Primary Issue: Dual Processing Paths
The code had two separate paths processing the same audio data:
1. **recordingProcess()** - Main recording loop accumulating data in `accumulatedAnalysisData`
2. **emitAudioData() → processAudioData()** - Secondary processing using class-level `analysisBuffer`

This created a memory multiplication effect where data was being accumulated in multiple buffers simultaneously.

### Timing Mismatch Problem
- Data emission interval: `interval` ms (default 1000ms)
- Analysis processing interval: `intervalAnalysis` ms (can be much larger, e.g., 5000ms+)
- With a 5x difference, the analysis buffer would accumulate 5x the expected data before resetting

### Memory Growth Calculation
Example with extreme configuration:
- Sample rate: 48kHz
- Channels: 2 (stereo)
- Bit depth: 32-bit (4 bytes per sample)
- Interval: 1000ms
- IntervalAnalysis: 300000ms (5 minutes)

Data rate: 48000 × 2 × 4 = 384,000 bytes/second
After 5 minutes: 384,000 × 300 = 115.2MB

With dual processing paths, this effectively doubles to ~230MB, easily causing OOM on devices with limited heap space.

## Solution Implemented

### 1. Eliminated Dual Processing
- Removed the `processAudioData()` call from `emitAudioData()`
- Consolidated all analysis processing in `recordingProcess()` method
- Moved waveform notification update to `emitAudioData()`

### 2. Added Safety Measures
- Implemented `MAX_ANALYSIS_BUFFER_SIZE` constant (20MB limit)
- Added size check before accumulating data to prevent unbounded growth
- Wrapped analysis processing in try-catch-finally to ensure buffer always resets

### 3. Fixed Accumulation Bug
- Moved `accumulatedAnalysisData.write()` outside the `shouldProcessAnalysis` check
- This ensures data is accumulated continuously, not just when processing

## Code Changes

### Key Changes in recordingProcess():
```kotlin
// Always accumulate data for analysis if enabled
if (recordingConfig.enableProcessing) {
    // Check buffer size to prevent OOM
    if (accumulatedAnalysisData.size() + bytesRead <= MAX_ANALYSIS_BUFFER_SIZE) {
        accumulatedAnalysisData.write(audioData, 0, bytesRead)
    } else {
        LogUtils.w(CLASS_NAME, "Analysis buffer size limit reached...")
    }
}

// Process analysis with try-catch-finally
if (shouldProcessAnalysis) {
    try {
        // Process and emit analysis data
        val analysisData = audioProcessor.processAudioData(...)
        // ... emit event
    } catch (e: Exception) {
        LogUtils.e(CLASS_NAME, "Failed to process audio analysis data", e)
    } finally {
        // Always reset the buffer to prevent unbounded growth
        accumulatedAnalysisData.reset()
    }
}
```

### Deprecated Method
- `processAudioData()` method is now deprecated and not called during recording
- Kept for potential future use but documented as unused

## JavaScript Analysis Retention

`useAudioRecorder` also maintains a full analysis history in JavaScript so
`stopRecording().analysisData` can include every analysis data point. This is
useful for short recordings and post-recording visualization, but it grows with
recording duration. For long-running sessions that consume `onAudioAnalysis`
chunks or only need the hook's recent live `analysisData` window, set
`keepFullAnalysis: false` in `RecordingConfig`. This flag only has an effect
when `enableProcessing: true`.

This option does not disable native analysis processing or per-callback
analysis events; it only skips the full-history array retained by the hook.

```ts
await startRecording({
  enableProcessing: true,
  keepFullAnalysis: false,
  onAudioAnalysis: async (analysis) => {
    // Use this chunk for live VAD, meters, or streaming decisions.
  },
})
```

## Testing Recommendations

1. **Long Recording Test**
   - Record for 30+ minutes with high sample rate (48kHz)
   - Monitor heap usage throughout recording
   - Verify no OOM errors occur

2. **Extreme Configuration Test**
   - Set `intervalAnalysis` to 5+ minutes
   - Use maximum sample rate and bit depth
   - Verify buffer size limit prevents excessive memory usage

3. **Memory Profiling**
   - Use Android Studio Profiler during recording
   - Monitor heap allocations and GC frequency
   - Ensure memory usage remains stable over time

## Future Improvements

1. Consider making `MAX_ANALYSIS_BUFFER_SIZE` configurable based on device capabilities
2. Add memory pressure monitoring and adaptive buffer sizing
3. Implement streaming analysis that doesn't require full buffer accumulation
4. Add metrics/logging for buffer size warnings to track in production

## Native Memory Growth Investigation - Bridge Architecture Limitation

### Investigation Summary (2024-08-02)
After extensive profiling and testing, the native memory growth was identified as a fundamental limitation of the current architecture rather than a true memory leak.

### Key Findings

#### 1. Memory Behavior Analysis
- **Without visualization/processing**: Memory grows at ~0.6MB/s but stabilizes with GC
- **With visualization enabled**: Memory grows at 2-3MB/s with graphics allocations
- **With notifications/waveforms**: Additional ~0.5MB/s growth
- **Thread count remains stable**: No thread leaks detected

#### 2. Root Cause: Expo Modules API Bridge Overhead
The library uses Expo Modules API, which even on React Native's new architecture:
- Still sends events through the bridge
- Requires base64 encoding for binary data
- Creates Bundle objects for each event
- Does NOT use JSI for direct memory sharing

Each audio event (at 500ms interval) creates:
- Base64 encoded string (~22KB for audio data)
- Bundle object with multiple fields
- Bridge serialization overhead
- Temporary native allocations (~300KB total per event)

These allocations accumulate until garbage collection runs, creating a sawtooth pattern.

#### 3. Memory Profiler Evidence
Native allocations traced to:
- `pthread_create`: 10,136 calls matching event emission rate
- `malloc`: 49MB accumulated allocations
- `Base64` encoding operations
- React Native bridge internals

### Why This Isn't a True Memory Leak

1. **Memory is reclaimable**: GC successfully reclaims memory (observed 51MB drops)
2. **Sawtooth pattern**: Memory grows then drops in regular cycles
3. **Baseline stable**: After GC, memory returns to similar levels
4. **Expected behavior**: This is normal for high-frequency bridge communication

### Current Limitations

The Expo Modules API does not yet support:
- JSI (JavaScript Interface) for direct memory access
- SharedArrayBuffer for zero-copy transfers
- TurboModules architecture benefits

### Recommended Solutions

#### Immediate Workarounds
1. **Reduce event frequency**: Increase interval from 500ms to 2000ms+
2. **Batch events**: Accumulate multiple chunks before sending
3. **Disable unnecessary features**: Turn off visualization, notifications, compression

#### Long-term Solutions
1. **Wait for Expo JSI support**: Expo team is working on JSI integration
2. **Implement as TurboModule**: Complete rewrite using JSI (complex)
3. **Alternative approaches**:
   - Write to file, read from JS periodically
   - Use WebSockets for streaming
   - Native UI component for visualization

### Performance Impact

With current architecture at 500ms interval:
- ~2 events/second
- ~600KB temporary allocations per second
- GC runs every ~60-90 seconds
- Memory usage cycles between 300-350MB

This is acceptable for most use cases but may cause issues on low-memory devices during extended recordings.