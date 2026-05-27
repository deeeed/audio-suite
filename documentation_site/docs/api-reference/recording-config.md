---
id: recording-config
title: Recording Configuration
sidebar_label: Recording Configuration
---

The recording configuration specifies the settings used for audio recording on different platforms. Below are the default settings for Android, iOS, and web platforms:

- On Android: 16kHz sample rate, 16-bit depth, 1 channel.
- On IOS: 48kHz sample rate, 16-bit depth, 1 channel.
- On the web, default configuration is 44.1kHz sample rate, 32-bit depth, 1 channel.

> **Note on iOS Recording**: The library now automatically detects and adapts to the hardware's actual sample rate on both iOS devices and simulators. This means you can specify any supported sample rate (e.g., 16kHz, 44.1kHz, 48kHz) in your configuration, and the library will:
> 
> 1. Capture audio at the hardware's native sample rate (typically 44.1kHz on simulators)
> 2. Perform high-quality resampling to match your requested sample rate
> 3. Deliver the final recording at your specified configuration
> 
> This automatic adaptation prevents crashes that previously occurred when the requested sample rate didn't match the hardware capabilities, especially in simulators.

```tsx
export interface RecordingConfig {
    sampleRate?: SampleRate // Sample rate for recording (16000, 44100, or 48000 Hz)
    channels?: 1 | 2 // Number of audio channels (1 for mono, 2 for stereo)
    encoding?: EncodingType // Encoding type for the recording (pcm_32bit, pcm_16bit, pcm_8bit)
    interval?: number // Interval in milliseconds at which to emit recording data (minimum: 10ms)
    intervalAnalysis?: number // Interval in milliseconds at which to emit analysis data (minimum: 10ms)

    // Device and notification settings
    keepAwake?: boolean // Continue recording when app is in background. On iOS, requires both 'audio' and 'processing' background modes (default is true)
    showNotification?: boolean // Show a notification during recording (default is false)
    showWaveformInNotification?: boolean // Show waveform in the notification (Android only)
    notification?: NotificationConfig // Configuration for the notification
    audioFocusStrategy?: 'background' | 'interactive' | 'communication' | 'none' // Audio focus strategy for handling interruptions (Android)

    // Audio processing settings
    enableProcessing?: boolean // Enable audio processing (default is false)
    keepFullAnalysis?: boolean // Retain the full live-analysis history for stopRecording().analysisData (default is true)
    pointsPerSecond?: number // Number of data points to extract per second of audio (default is 10)
    algorithm?: AmplitudeAlgorithm // Algorithm to use for amplitude computation (default is "rms")
    features?: AudioFeaturesOptions // Feature options to extract (default is empty)

    // Platform specific configuration
    ios?: IOSConfig // iOS-specific configuration
    web?: WebConfig // Web-specific configuration

    // Output configuration
    output?: OutputConfig // Control which files are created during recording
    outputDirectory?: string // Custom directory for saving recordings (uses app default if not specified)
    filename?: string // Custom filename for the recording (uses UUID if not specified)

    // Interruption handling
    autoResumeAfterInterruption?: boolean // Whether to automatically resume after interruption
    onRecordingInterrupted?: (_: RecordingInterruptionEvent) => void // Callback for interruption events

    // Active recording duration limit
    maxDurationMs?: number // Maximum cumulative active recording duration in milliseconds. Paused time does not count.
    autoStopOnMaxDuration?: boolean // Whether to stop automatically when maxDurationMs is reached (default is false)
    onMaxDurationReached?: (_: MaxDurationReachedEvent) => void // Callback for max-duration events

    // Callback functions
    onAudioStream?: (_: AudioDataEvent) => Promise<void> // Callback function to handle audio stream
    onAudioAnalysis?: (_: AudioAnalysisEvent) => Promise<void> // Callback function to handle audio features
    
    // Performance options
    bufferDurationSeconds?: number // Buffer duration in seconds (controls audio buffer size)

    // Stream format
    streamFormat?: 'float32' | 'raw' // Controls data type in onAudioStream. 'float32' delivers Float32Array on all platforms; 'raw' (default) delivers base64 string on native, Float32Array on web.
}

```

## Platform-Specific Architecture

### Web

On the web, the recording utilizes the `AudioWorkletProcessor` for handling audio data. The `AudioWorkletProcessor` allows for real-time audio processing directly in the browser, making it a powerful tool for web-based audio applications.

### Android

On Android, the recording is managed using Android's native `AudioRecord` API along with `AudioFormat` and `MediaRecorder`. These classes are part of the Android framework and provide low-level access to audio hardware, allowing for high-quality audio recording.

### iOS

On iOS, the recording is managed using `AVAudioEngine` and related classes from the `AVFoundation` framework. The implementation uses a sophisticated audio handling approach that:
- Automatically detects and adapts to the hardware's native sample rate
- Handles sample rate mismatches between iOS audio session and actual hardware capabilities
- Performs high-quality resampling to match the requested configuration
- Works reliably on both physical devices and simulators regardless of the requested sample rate
- Supports both 16-bit and 32-bit PCM formats
- Maintains audio quality through intermediate Float32 format when necessary

## Event Emission Intervals

The `interval` and `intervalAnalysis` options control how frequently audio data and analysis events are emitted during recording. Both have a minimum value of 10ms to ensure consistent behavior across platforms while preventing excessive CPU usage.

### Performance Considerations

| Interval | CPU Usage | Battery Impact | Use Case |
|----------|-----------|----------------|----------|
| 10-50ms | High | High | Real-time visualizations, live frequency analysis |
| 50-100ms | Medium | Medium | Responsive UI updates, waveform display |
| 100-500ms | Low | Low | Progress indicators, level meters |
| 500ms+ | Very Low | Minimal | File size monitoring, duration tracking |

### Best Practices

1. **For real-time visualizations**: Use `intervalAnalysis: 10` with minimal features enabled
2. **For general recording**: Use `interval: 100` or higher to balance responsiveness and performance
3. **For battery-sensitive apps**: Use intervals of 500ms or higher
4. **Platform considerations**: While both iOS and Android support 10ms intervals, actual performance may vary based on device capabilities

Example configuration for real-time visualization:
```tsx
const realtimeConfig = {
  intervalAnalysis: 10,      // 10ms for smooth updates
  interval: 100,             // 100ms for data emission
  enableProcessing: true,
  features: {
    fft: true,              // Only enable what you need
    energy: false,
    rms: false
  }
};
```

## Max Active Recording Duration {#max-active-recording-duration}

Use `maxDurationMs` to define a cumulative active recording limit. The timer
pauses when recording is paused, so interruption pauses and manual pauses do not
consume the limit.

```tsx
await startRecording({
  sampleRate: 16000,
  channels: 1,
  maxDurationMs: 60_000,
  autoStopOnMaxDuration: true,
  onMaxDurationReached: (event) => {
    console.log('Recording limit reached', {
      durationMs: event.durationMs,
      maxDurationMs: event.maxDurationMs,
      overrunMs: event.overrunMs,
      autoStopped: event.autoStopped,
    })
  },
})
```

Behavior:

1. `maxDurationMs` set to `undefined`, `0`, or a negative value disables the limit.
2. `autoStopOnMaxDuration: false` emits `onMaxDurationReached` and keeps recording.
3. `autoStopOnMaxDuration: true` emits `onMaxDurationReached` and then stops recording automatically.
4. `maxDurationMs` and `maxDurationReached` remain available in hook/status state after stop so UI can explain why recording ended.

When auto-stop is enabled, the automatic stop result is not passed to
`onMaxDurationReached`. Use the event for immediate UI updates and the normal
recording state/results flow to observe the stopped state.

## Live Analysis Retention {#live-analysis-retention}

When `enableProcessing: true`, `useAudioRecorder` exposes two live-analysis paths:

- `analysisData` in hook state keeps a recent rolling window for visualizers and meters.
- `onAudioAnalysis` receives each emitted analysis chunk as recording continues.

By default, the hook also keeps the full analysis history and attaches it to `stopRecording().analysisData`. This preserves existing behavior and is convenient for short recordings or post-recording charts, but the retained data grows with recording duration. For long-running sessions that only need the live state or callback chunks, set `keepFullAnalysis: false`.

```tsx
await startRecording({
  sampleRate: 16000,
  channels: 1,
  enableProcessing: true,
  keepFullAnalysis: false,
  intervalAnalysis: 250,
  onAudioAnalysis: async (analysis) => {
    // Use this chunk for live VAD, meters, or streaming decisions.
    updateVoiceActivity(analysis.dataPoints)
  },
})

const result = await stopRecording()
console.log(result.analysisData) // undefined when keepFullAnalysis is false
```

Important behavior:

- `keepFullAnalysis` only has an effect when `enableProcessing: true`.
- It does **not** disable native audio processing, the live `analysisData` window, or `onAudioAnalysis` events.
- It only controls whether the hook retains the full JavaScript history for `stopRecording().analysisData`.
- If you need a full-recording analysis after a long session, prefer running `extractAudioAnalysis()` on the saved file after recording stops instead of retaining every live chunk in memory.

## Platform Differences

### Android and iOS

On Android and iOS, the library attempts to record audio in the specified format. On iOS, the audio is automatically resampled to match the requested configuration using AVAudioConverter, ensuring high-quality output even when the hardware sample rate differs from the target rate.

### Web

On the web, the default configuration is typically higher, with a 44.1kHz sample rate and 32-bit depth. This ensures better sound quality, but it can lead to issues when resampling is required to lower settings.

## Recording Process 

To start recording, you use the `startRecording` function which accepts a `RecordingConfig` object. The output of this function is a `StartRecordingResult`.

```tsx
export interface StartRecordingResult {
    fileUri: string
    mimeType: string
    channels?: number
    bitDepth?: BitDepth
    sampleRate?: SampleRate
    compression?: {
        compressedFileUri: string
        size: number
        mimeType: string
        bitrate: number
        format: string
    }
}
```

## Zero-Latency Recording

The library provides a `prepareRecording` method that can significantly reduce the latency between a user action and the actual start of recording. This is particularly useful for time-sensitive applications where any delay in starting audio capture could be problematic.

### How it Works

When using the standard `startRecording` function, there's an inherent delay caused by several initialization steps:

1. Requesting user permissions (if not already granted)
2. Setting up audio sessions
3. Allocating memory for audio buffers
4. Initializing hardware resources
5. Configuring encoders and audio processing pipelines

The `prepareRecording` method decouples these initialization steps from the actual recording start, allowing your application to pre-initialize all necessary resources in advance.

### Using prepareRecording

```tsx
import { useAudioRecorder, useSharedAudioRecorder } from '@siteed/audio-studio';

// With individual recorder hook
const { 
  prepareRecording, 
  startRecording, 
  stopRecording 
} = useAudioRecorder();

// Or with shared recorder context
const { 
  prepareRecording, 
  startRecording, 
  stopRecording 
} = useSharedAudioRecorder();

// Prepare recording during component mounting or any appropriate initialization phase
useEffect(() => {
  const prepare = async () => {
    await prepareRecording({
      sampleRate: 44100,
      channels: 1,
      encoding: 'pcm_16bit',
      // Add any other recording configuration options
    });
    console.log('Recording resources prepared and ready');
  };
  
  prepare();
}, []);

// Later, when the user triggers recording, it starts with minimal latency
const handleRecordButton = async () => {
  await startRecording({
    // Use the same configuration as in prepareRecording
    sampleRate: 44100,
    channels: 1,
    encoding: 'pcm_16bit',
  });
};
```

### Key Benefits

- **Eliminates perceptible lag** between user action and recording start
- **Improves user experience** for time-sensitive applications
- **Consistent behavior** across all supported platforms
- **Maintains audio quality** while reducing startup latency

### Implementation Notes

1. Call `prepareRecording` as early as possible, such as during screen loading
2. Use identical configuration for both `prepareRecording` and `startRecording`
3. The preparation state persists until recording starts or the app is terminated
4. If `startRecording` is called without prior preparation, it performs normal initialization
5. Resources are automatically released when recording starts or when the component is unmounted

### Example: Capture Time-Critical Audio

This example demonstrates how to implement a voice command system where capturing the beginning of speech is critical:

```tsx
function VoiceCommandScreen() {
  const { 
    prepareRecording, 
    startRecording, 
    stopRecording,
    isRecording 
  } = useSharedAudioRecorder();
  
  // Prepare audio resources when screen loads
  useEffect(() => {
    const prepareAudio = async () => {
      await prepareRecording({
        sampleRate: 16000, // Optimized for speech
        channels: 1,
        encoding: 'pcm_16bit',
        enableProcessing: true,
        features: {
          energy: true,
          rms: true,
        }
      });
    };
    
    prepareAudio();
    
    return () => {
      // Clean up if needed
      if (isRecording) {
        stopRecording();
      }
    };
  }, []);
  
  return (
    <View style={styles.container}>
      <Text style={styles.instructions}>
        Press and hold to capture voice command
      </Text>
      
      <Pressable
        onPressIn={() => startRecording({
          sampleRate: 16000,
          channels: 1,
          encoding: 'pcm_16bit',
          enableProcessing: true,
          features: {
            energy: true,
            rms: true,
          }
        })}
        onPressOut={stopRecording}
        style={({ pressed }) => [
          styles.recordButton,
          { backgroundColor: pressed || isRecording ? 'red' : 'blue' }
        ]}
      >
        <Text style={styles.buttonText}>
          {isRecording ? 'Recording...' : 'Press to Record'}
        </Text>
      </Pressable>
    </View>
  );
}
```

## Web Memory Optimization {#web-memory-optimization}

On the web platform, audio recording can consume significant memory, especially for longer recordings. The library offers a memory optimization option to reduce memory usage by controlling how uncompressed audio data is stored.

### Web Configuration Options

```tsx
interface WebConfig {
    /**
     * Whether to store uncompressed audio data for WAV generation (web only)
     * 
     * Default: true (for backward compatibility)
     */
    storeUncompressedAudio?: boolean
}
```

### Memory Usage Control

The `storeUncompressedAudio` option lets you control how audio data is handled in memory:

- **When true (default)**: All PCM chunks are stored in memory during recording, enabling WAV file generation when compression is disabled. This provides maximum flexibility but can use significant memory for long recordings.

- **When false**: Only compressed audio is kept (if compression is enabled), significantly reducing memory usage. This is ideal for long recordings where memory constraints are a concern.

### Example Usage

```tsx
const { startRecording } = useAudioRecorder();

// Memory-efficient recording for long sessions
await startRecording({
  sampleRate: 44100,
  channels: 1,
  compression: {
    enabled: true,  // Enable compression to ensure audio is captured
    format: 'opus',
    bitrate: 64000
  },
  web: {
    storeUncompressedAudio: false  // Only store compressed data
  }
});
```

### Platform Behavior

- **Web**: The `storeUncompressedAudio` setting controls in-memory storage of PCM data
- **iOS/Android**: This setting has no effect, as these platforms always write directly to files rather than storing in memory

## Output Configuration {#output-configuration}

The library provides flexible control over which audio files are created during recording. You can choose to save uncompressed WAV files, compressed audio files, both, or neither (for streaming-only scenarios).

> **⚠️ Breaking Change (Web)**: The web-specific `web.storeUncompressedAudio` option has been removed and replaced with `output.primary.enabled`. See the [Output Configuration](#output-configuration) section below for migration details.

### Configuration Structure

```tsx
output?: {
    primary?: {
        enabled?: boolean    // Whether to create the primary WAV file (default: true)
        format?: 'wav'       // Currently only 'wav' is supported
    }
    compressed?: {
        enabled?: boolean    // Whether to create a compressed file (default: false)
        format?: 'aac' | 'opus'  // Compression format
        bitrate?: number     // Bitrate in bits per second (default: 128000)
    }
}
```

### Supported Formats

- **AAC (Advanced Audio Coding)**:
  - High-quality lossy compression
  - Excellent for voice and music
  - Widely supported on all platforms
  - Recommended bitrate: 64000-256000 bps

- **Opus**:
  - Modern, high-efficiency codec
  - Superior quality at low bitrates
  - Excellent for speech compression
  - Recommended bitrate: 16000-96000 bps

### Usage Examples

```tsx
const { startRecording } = useAudioRecorder();

// Example 1: Default behavior - only primary WAV file
await startRecording({
  sampleRate: 44100,
  channels: 1,
  encoding: 'pcm_16bit'
  // output is undefined, defaults to { primary: { enabled: true } }
});

// Example 2: Both WAV and compressed files
await startRecording({
  sampleRate: 44100,
  channels: 1,
  encoding: 'pcm_16bit',
  output: {
    compressed: {
      enabled: true,
      format: 'aac',
      bitrate: 128000 // 128 kbps
    }
    // primary is not specified, defaults to enabled
  }
});

// Example 3: Only compressed file (no WAV)
await startRecording({
  sampleRate: 44100,
  channels: 1,
  output: {
    primary: { enabled: false },
    compressed: {
      enabled: true,
      format: 'opus',
      bitrate: 64000 // 64 kbps
    }
  }
});

// Example 4: Streaming only (no files)
await startRecording({
  sampleRate: 16000,
  channels: 1,
  output: {
    primary: { enabled: false }
  },
  onAudioStream: async (data) => {
    // Process audio in real-time
  }
});
```

### Accessing Output Files

The recording result structure depends on which outputs were enabled:

```tsx
const { stopRecording } = useAudioRecorder();

const handleStopRecording = async () => {
  const result = await stopRecording();
  
  // Primary WAV file (if enabled)
  if (result.fileUri) {
    console.log('Primary file:', result.fileUri);
    console.log('Primary size:', result.size, 'bytes');
    console.log('Format:', result.mimeType); // 'audio/wav'
  }
  
  // Compressed file (if enabled)
  if (result.compression) {
    console.log('Compressed file:', result.compression.compressedFileUri);
    console.log('Compressed size:', result.compression.size, 'bytes');
    console.log('Compression format:', result.compression.format);
    console.log('Bitrate:', result.compression.bitrate, 'bps');
  }
  
  // If no outputs were enabled (streaming only)
  if (!result.fileUri && !result.compression) {
    console.log('No files created - streaming only mode');
  }
};
```

### Platform Considerations

- **iOS**: 
  - AAC is supported and recommended
  - Opus format is **not supported** on iOS - if requested, the library will automatically fall back to AAC format and emit a warning
  - Files are written directly to disk rather than stored in memory
- **Android**: 
  - Both AAC and Opus are supported
  - Files are written directly to disk rather than stored in memory
- **Web**: 
  - Opus is supported
  - AAC support depends on browser
  - Data is stored in memory during recording unless `storeUncompressedAudio: false` is set

### Streaming Audio Data

You can access both raw and compressed audio data in real-time during recording using the `onAudioStream` callback:

```tsx
await startRecording({
  // ... other config options
  output: {
    compressed: {
      enabled: true,
      format: 'opus',
      bitrate: 64000
    }
  },
  onAudioStream: async (event) => {
    // Raw PCM audio data (always available)
    console.log('Raw data size:', event.eventDataSize);
    
    // Compressed audio chunk (if compression is enabled)
    if (event.compression?.data) {
      console.log('Compressed chunk size:', 
        typeof event.compression.data === 'string' 
          ? event.compression.data.length 
          : event.compression.data.size
      );
    }
  }
});
```

## Buffer Duration Control {#buffer-duration}

The `bufferDurationSeconds` option allows you to control the size of audio buffers used during recording. This affects both latency and CPU usage.

### Configuration

```tsx
const config = {
    bufferDurationSeconds: 0.1, // 100ms buffers
    // ... other config options
};
```

**Default Behavior**: When `bufferDurationSeconds` is not specified (undefined):
- The library requests 1024 frames (platform default)
- At 44.1kHz, this equals ~23ms
- However, iOS enforces a minimum of ~0.1s (4800 frames at 48kHz)
- Android and Web respect the 1024 frame default

### Performance Trade-offs

| Buffer Size | Latency | CPU Usage | Best For |
|------------|---------|-----------|----------|
| < 50ms | Very Low | High | Real-time processing, voice commands |
| 50-200ms | Low-Medium | Medium | Balanced performance |
| > 200ms | Higher | Low | Efficient recording, battery optimization |

### Platform Behavior

- **iOS**: Enforces a minimum buffer size of ~0.1 seconds (4800 frames at 48kHz). Smaller requests are automatically handled through buffer accumulation.
- **Android**: Respects requested buffer sizes within hardware limits
- **Web**: Fully configurable through Web Audio API

### Example: Low-Latency Voice Detection

```tsx
await startRecording({
    sampleRate: 16000,
    channels: 1,
    bufferDurationSeconds: 0.02, // Request 20ms buffers
    output: {
        primary: { enabled: false } // No file I/O for lower latency
    },
    onAudioStream: async (data) => {
        // Process voice commands with minimal delay
        const command = await detectVoiceCommand(data);
        if (command) {
            await handleCommand(command);
        }
    }
});
```

## Streaming-Only Mode {#streaming-only}

You can configure the library to stream audio data without creating any files on disk. This is ideal for real-time processing scenarios where you don't need to persist the audio.

### Configuration

```tsx
const config = {
    output: {
        primary: { enabled: false }  // Disable all file creation
    },
    // ... other config options
};
```

### Benefits

- **Reduced I/O overhead**: No disk writes during recording
- **Lower storage usage**: No temporary files created
- **Better battery life**: Less system resource usage
- **Improved performance**: All processing happens in memory

### Important Notes

- When no outputs are enabled, the recording result will have empty `fileUri` and no `compression` object
- Audio data is only available through the `onAudioStream` callback
- You must implement `onAudioStream` to capture the audio data

### Example: Real-Time Transcription

```tsx
const transcriptionService = new TranscriptionService();

await startRecording({
    sampleRate: 16000,
    channels: 1,
    bufferDurationSeconds: 0.05, // 50ms chunks
    output: {
        primary: { enabled: false }  // No files needed
    },
    onAudioStream: async (data) => {
        // Send audio directly to transcription service
        const transcript = await transcriptionService.process(data);
        updateTranscriptUI(transcript);
    }
});

// When stopping, no files will be returned
const result = await stopRecording();
console.log(result.fileUri); // Will be undefined
console.log(result.compression); // Will be undefined
```

### Example: Live Streaming to Server

```tsx
const websocket = new WebSocket('wss://audio-server.com/stream');

await startRecording({
    sampleRate: 44100,
    channels: 2,
    bufferDurationSeconds: 0.1, // 100ms chunks for network efficiency
    output: {
        primary: { enabled: false }  // Stream only
    },
    onAudioStream: async (data) => {
        if (websocket.readyState === WebSocket.OPEN) {
            // Stream audio data to server
            websocket.send(data.data);
        }
    }
});
```

### Combining with Buffer Duration

These options work well together for optimizing streaming scenarios:

```tsx
// Ultra-low latency configuration
const lowLatencyConfig = {
    bufferDurationSeconds: 0.01, // 10ms (will use 100ms on iOS)
    output: {
        primary: { enabled: false }  // No file I/O
    },
    // ... other options
};

// Efficient streaming configuration
const efficientStreamingConfig = {
    bufferDurationSeconds: 0.2, // 200ms for network efficiency
    output: {
        primary: { enabled: false }  // Stream only
    },
    // ... other options
};
```

## Example Usage

```tsx
import { useAudioRecorder } from '@siteed/audio-studio';

const config = {
    sampleRate: 16000,
    channels: 1,
    encoding: 'pcm_16bit',
    interval: 500,
    enableProcessing: true,
    keepAwake: true,
    showNotification: true,
    output: {
        compressed: {
            enabled: true,
            format: 'aac',
            bitrate: 128000
        }
    },
    pointsPerSecond: 1000,
    algorithm: 'rms',
    features: { energy: true, rms: true },
    autoResumeAfterInterruption: true,
    audioFocusStrategy: 'background', // Continue recording through interruptions
    onAudioStream: async (event) => {
        console.log('Audio data:', event);
    },
    onAudioAnalysis: async (data) => {
        console.log('Processing:', data);
    },
    onRecordingInterrupted: (event) => {
        console.log('Recording interrupted:', event);
    }
};

const {
    startRecording,
    stopRecording,
    isRecording,
    durationMs,
    size,
} = useAudioRecorder({ debug: true });

const handleStart = async () => {
    const { granted } = await Audio.requestPermissionsAsync();
    if (granted) {
        const result = await startRecording(config);
        console.log('Recording started with config:', result);
    }
};

const handleStop = async () => {
    const result = await stopRecording();
    console.log('Recording stopped with result:', result);
};
```

## Recording Interruption Handling

The library provides robust handling of recording interruptions that may occur during audio capture. These interruptions can happen for various reasons such as incoming phone calls or audio focus changes.

### Interruption Types

The `RecordingInterruptionEvent` includes the following possible reasons for interruption:

```tsx
type RecordingInterruptionReason =
    | 'audioFocusLoss'    // Another app has taken audio focus
    | 'audioFocusGain'    // Audio focus has been regained
    | 'phoneCall'         // An incoming phone call has interrupted recording
    | 'phoneCallEnded'    // The interrupting phone call has ended
```

### Handling Interruptions

You can handle interruptions in two ways:

1. **Automatic Resume**: Set `autoResumeAfterInterruption: true` in your config to automatically resume recording after an interruption ends.

2. **Manual Handling**: Use the `onRecordingInterrupted` callback to implement custom interruption handling:

```tsx
const config = {
    // ... other config options ...
    autoResumeAfterInterruption: false,
    onRecordingInterrupted: (event) => {
        const { reason, isPaused } = event;
        
        switch (reason) {
            case 'phoneCall':
                console.log('Recording paused due to phone call');
                break;
            case 'phoneCallEnded':
                console.log('Phone call ended, can resume recording');
                break;
            case 'audioFocusLoss':
                console.log('Audio focus lost to another app');
                break;
            case 'audioFocusGain':
                console.log('Audio focus regained');
                break;
        }
        
        console.log('Recording is currently paused:', isPaused);
    }
};
```

### Platform Behavior

- **iOS**: 
  - Interruptions are handled through the AVAudioSession system
  - Phone call handling is enabled by default (can be disabled via `enablePhoneStateHandling: false`)
- **Android**: 
  - Interruptions are managed via AudioManager focus changes
  - Phone call handling is enabled by default (can be disabled via `enablePhoneStateHandling: false`)
- **Web**: 
  - Interruptions are handled through the Web Audio API's state changes
  - Phone call handling is not supported

## Audio Focus Strategy (Android)

The `audioFocusStrategy` option controls how your app handles audio focus changes on Android. This affects how recording behaves when other apps want to play audio or when the user interacts with system audio controls.

### Available Strategies

- **`'background'`** (default when `keepAwake: true`): Continue recording when app loses focus
  - Best for: Voice recorders, transcription apps, meeting recording
  - Behavior: Recording continues even when other apps play audio
  - Use case: Long-term recording where interruptions should not stop recording

- **`'interactive'`** (default when `keepAwake: false`): Pause when losing focus, resume when gaining
  - Best for: Music apps, games, interactive audio apps
  - Behavior: Automatically pauses recording when another app needs audio focus
  - Use case: User-interactive recording where interruptions should pause recording

- **`'communication'`**: Maintain priority for real-time communication
  - Best for: Video calls, voice chat, live streaming
  - Behavior: Requests exclusive audio access with high priority
  - Use case: Real-time communication where audio quality is critical

- **`'none'`**: No automatic audio focus management
  - Best for: Custom handling scenarios
  - Behavior: Your app handles all audio focus changes manually
  - Use case: When you need complete control over audio focus behavior

### Default Behavior

The library automatically selects an appropriate strategy based on your configuration:
- When `keepAwake: true` → defaults to `'background'`
- When `keepAwake: false` → defaults to `'interactive'`

### Configuration Examples

```tsx
// Long-term recording (voice recorder, meeting recording)
const voiceRecorderConfig = {
  keepAwake: true,
  audioFocusStrategy: 'background', // Continue recording through interruptions
  autoResumeAfterInterruption: true,
  // ... other config
};

// Interactive recording (music app, game)
const interactiveConfig = {
  keepAwake: false,
  audioFocusStrategy: 'interactive', // Pause on interruptions
  autoResumeAfterInterruption: true,
  // ... other config
};

// Real-time communication (video call, voice chat)
const communicationConfig = {
  sampleRate: 16000, // Optimized for speech
  audioFocusStrategy: 'communication', // High priority audio access
  autoResumeAfterInterruption: false, // Manual handling for communication apps
  // ... other config
};

// Custom audio focus handling
const customConfig = {
  audioFocusStrategy: 'none', // No automatic handling
  onRecordingInterrupted: (event) => {
    // Implement custom logic for audio focus changes
    if (event.reason === 'audioFocusLoss') {
      // Handle focus loss manually
    }
  },
  // ... other config
};
```

### Platform Notes

- **Android**: Full support for all audio focus strategies
- **iOS**: This option has no effect on iOS (audio session management is handled differently)
- **Web**: This option has no effect on web platforms

## Background Recording on iOS

When setting `keepAwake: true` for iOS background recording:

- **Required**: The `audio` background mode
  - This is essential for accessing the microphone in the background
  - Without this, iOS will suspend your audio session when backgrounded
  
- **Recommended**: The `processing` background mode
  - Provides additional background execution time for audio processing
  - Helpful for longer recordings or when using audio analysis features

### iOS Configuration

In your `app.config.ts` or plugin configuration:

```typescript
iosBackgroundModes: {
  useAudio: true,     // REQUIRED for background recording
  useProcessing: true // RECOMMENDED for better performance
}
```

The key takeaway: `useAudio: true` is required for any background recording to work.

## Troubleshooting Background Recording

If recording stops when your app moves to the background despite having `keepAwake: true`:

- **iOS**: Verify your app has the "audio" background mode in Info.plist (required)
  - Adding the "processing" background mode is also recommended
- **Android**: Check that your app has the required foreground service permissions

Example iOS Info.plist configuration:

```xml
<key>UIBackgroundModes</key>
<array>
  &lt;string&gt;audio</string>
  &lt;string&gt;processing</string> <!-- recommended but optional -->
  <!-- other background modes -->
</array>
```

## Example Usage

```tsx
import { useAudioRecorder } from '@siteed/audio-studio';

const config = {
    sampleRate: 16000,
    channels: 1,
    encoding: 'pcm_16bit',
    interval: 500,
    enableProcessing: true,
    keepAwake: true,
    showNotification: true,
    output: {
        compressed: {
            enabled: true,
            format: 'aac',
            bitrate: 128000
        }
    },
    pointsPerSecond: 1000,
    algorithm: 'rms',
    features: { energy: true, rms: true },
    autoResumeAfterInterruption: true,
    audioFocusStrategy: 'background', // Continue recording through interruptions
    onAudioStream: async (event) => {
        console.log('Audio data:', event);
    },
    onAudioAnalysis: async (data) => {
        console.log('Processing:', data);
    },
    onRecordingInterrupted: (event) => {
        console.log('Recording interrupted:', event);
    }
};

const {
    startRecording,
    stopRecording,
    isRecording,
    durationMs,
    size,
} = useAudioRecorder({ debug: true });

const handleStart = async () => {
    const { granted } = await Audio.requestPermissionsAsync();
    if (granted) {
        const result = await startRecording(config);
        console.log('Recording started with config:', result);
    }
};

const handleStop = async () => {
    const result = await stopRecording();
    console.log('Recording stopped with result:', result);
};
```
