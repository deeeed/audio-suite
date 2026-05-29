[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / RecordingConfig

# Interface: RecordingConfig

Defined in: [src/AudioStudio.types.ts:412](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L412)

## Properties

### android?

> `optional` **android?**: [`AndroidConfig`](AndroidConfig.md)

Defined in: [src/AudioStudio.types.ts:472](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L472)

Android-specific configuration

***

### autoResumeAfterInterruption?

> `optional` **autoResumeAfterInterruption?**: `boolean`

Defined in: [src/AudioStudio.types.ts:501](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L501)

Whether to automatically resume recording after an interruption (default is false)

***

### autoStopOnMaxDuration?

> `optional` **autoStopOnMaxDuration?**: `boolean`

Defined in: [src/AudioStudio.types.ts:521](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L521)

Stop recording automatically when maxDurationMs is reached.

Defaults to false. When used with `useAudioRecorder`, the
MaxDurationReached event is emitted immediately, then the hook stops the
recorder and exposes the final result through `onRecordingStopped`.

***

### bufferDurationSeconds?

> `optional` **bufferDurationSeconds?**: `number`

Defined in: [src/AudioStudio.types.ts:569](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L569)

Buffer duration in seconds. Controls the size of audio buffers
used during recording. Smaller values reduce latency but increase
CPU usage. Larger values improve efficiency but increase latency.

Platform Notes:
- iOS/macOS: Minimum effective 0.1s, uses accumulation below
- Android: Respects all sizes within hardware limits
- Web: Fully configurable

Default: undefined (uses platform default ~23ms at 44.1kHz)
Recommended: 0.01 - 0.5 seconds
Optimal iOS: >= 0.1 seconds

***

### channels?

> `optional` **channels?**: `1` \| `2`

Defined in: [src/AudioStudio.types.ts:417](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L417)

Number of audio channels (1 for mono, 2 for stereo)

***

### deviceDisconnectionBehavior?

> `optional` **deviceDisconnectionBehavior?**: [`DeviceDisconnectionBehaviorType`](../type-aliases/DeviceDisconnectionBehaviorType.md)

Defined in: [src/AudioStudio.types.ts:553](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L553)

How to handle device disconnection during recording

***

### deviceId?

> `optional` **deviceId?**: `string`

Defined in: [src/AudioStudio.types.ts:550](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L550)

ID of the device to use for recording (if not specified, uses default)

***

### enableProcessing?

> `optional` **enableProcessing?**: `boolean`

Defined in: [src/AudioStudio.types.ts:455](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L455)

Enable audio processing (default is false)

***

### encoding?

> `optional` **encoding?**: [`EncodingType`](../type-aliases/EncodingType.md)

Defined in: [src/AudioStudio.types.ts:434](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L434)

Encoding type for the recording.

Platform limitations:
- `pcm_8bit`: Android only (iOS/Web will fallback to `pcm_16bit` with warning)
- `pcm_16bit`: All platforms (recommended for cross-platform compatibility)
- `pcm_32bit`: All platforms

The library will automatically validate and adjust the encoding based on
platform capabilities. A warning will be logged if fallback is required.

#### Default

```ts
'pcm_16bit'
```

#### See

 - [EncodingType](../type-aliases/EncodingType.md)
 - [Platform Limitations](https://github.com/deeeed/audiolab/blob/main/packages/audio-studio/docs/PLATFORM_LIMITATIONS.md)

***

### features?

> `optional` **features?**: [`AudioFeaturesOptions`](AudioFeaturesOptions.md)

Defined in: [src/AudioStudio.types.ts:481](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L481)

Feature options to extract during audio processing

***

### filename?

> `optional` **filename?**: `string`

Defined in: [src/AudioStudio.types.ts:547](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L547)

Optional filename for the recording (uses UUID if not provided)

***

### interval?

> `optional` **interval?**: `number`

Defined in: [src/AudioStudio.types.ts:437](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L437)

Interval in milliseconds at which to emit recording data (minimum: 10ms)

***

### intervalAnalysis?

> `optional` **intervalAnalysis?**: `number`

Defined in: [src/AudioStudio.types.ts:440](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L440)

Interval in milliseconds at which to emit analysis data (minimum: 10ms)

***

### ios?

> `optional` **ios?**: [`IOSConfig`](IOSConfig.md)

Defined in: [src/AudioStudio.types.ts:469](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L469)

iOS-specific configuration

***

### keepAwake?

> `optional` **keepAwake?**: `boolean`

Defined in: [src/AudioStudio.types.ts:443](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L443)

Keep the device awake while recording (default is false)

***

### keepFullAnalysis?

> `optional` **keepFullAnalysis?**: `boolean`

Defined in: [src/AudioStudio.types.ts:466](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L466)

Whether `useAudioRecorder` should retain every audio-analysis data point
and attach the full history to `stopRecording().analysisData`.

Defaults to `true` for backwards compatibility. Set to `false` for
long-running recordings when you only need live `analysisData` state or
per-callback `onAudioAnalysis` chunks; this avoids unbounded JS memory
growth in the hook without disabling native analysis processing.

***

### maxDurationMs?

> `optional` **maxDurationMs?**: `number`

Defined in: [src/AudioStudio.types.ts:511](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L511)

Maximum cumulative active recording duration, in milliseconds.

Paused time does not count. Set to undefined, 0, or a negative value to disable.

***

### notification?

> `optional` **notification?**: [`NotificationConfig`](NotificationConfig.md)

Defined in: [src/AudioStudio.types.ts:452](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L452)

Configuration for the notification

***

### onAudioAnalysis?

> `optional` **onAudioAnalysis?**: (`_`) => `Promise`\<`void`\>

Defined in: [src/AudioStudio.types.ts:487](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L487)

Callback function to handle audio features extraction results

#### Parameters

##### \_

`AudioAnalysisEvent`

#### Returns

`Promise`\<`void`\>

***

### onAudioStream?

> `optional` **onAudioStream?**: (`_`) => `Promise`\<`void`\>

Defined in: [src/AudioStudio.types.ts:484](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L484)

Callback function to handle audio stream data

#### Parameters

##### \_

[`AudioDataEvent`](../type-aliases/AudioDataEvent.md)

#### Returns

`Promise`\<`void`\>

***

### onMaxDurationReached?

> `optional` **onMaxDurationReached?**: (`_`) => `void`

Defined in: [src/AudioStudio.types.ts:530](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L530)

Optional callback invoked when maxDurationMs is reached.

This remains an immediate threshold callback. If
autoStopOnMaxDuration is true, use `onRecordingStopped` for the full
recording result after stop completes.

#### Parameters

##### \_

[`MaxDurationReachedEvent`](MaxDurationReachedEvent.md)

#### Returns

`void`

***

### onRecordingInterrupted?

> `optional` **onRecordingInterrupted?**: (`_`) => `void`

Defined in: [src/AudioStudio.types.ts:504](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L504)

Optional callback to handle recording interruptions

#### Parameters

##### \_

[`RecordingInterruptionEvent`](RecordingInterruptionEvent.md)

#### Returns

`void`

***

### onRecordingStopped?

> `optional` **onRecordingStopped?**: (`recording`, `reason`) => `void` \| `Promise`\<`void`\>

Defined in: [src/AudioStudio.types.ts:539](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L539)

Optional callback invoked after a recording has fully stopped and the
final `AudioRecording` result is available.

The reason is `manual` when stopped through `stopRecording()` and
`maxDuration` when stopped by `autoStopOnMaxDuration`.

#### Parameters

##### recording

[`AudioRecording`](AudioRecording.md)

##### reason

[`RecordingStopReason`](../type-aliases/RecordingStopReason.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### output?

> `optional` **output?**: [`OutputConfig`](OutputConfig.md)

Defined in: [src/AudioStudio.types.ts:498](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L498)

Configuration for audio output files

Examples:
- Primary only (default): `{ primary: { enabled: true } }`
- Compressed only: `{ primary: { enabled: false }, compressed: { enabled: true, format: 'aac' } }`
- Both outputs: `{ compressed: { enabled: true } }`
- Streaming only: `{ primary: { enabled: false } }`

***

### outputDirectory?

> `optional` **outputDirectory?**: `string`

Defined in: [src/AudioStudio.types.ts:545](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L545)

Optional directory path where output files will be saved

***

### sampleRate?

> `optional` **sampleRate?**: [`SampleRate`](../type-aliases/SampleRate.md)

Defined in: [src/AudioStudio.types.ts:414](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L414)

Sample rate for recording in Hz (16000, 44100, or 48000)

***

### segmentDurationMs?

> `optional` **segmentDurationMs?**: `number`

Defined in: [src/AudioStudio.types.ts:478](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L478)

Duration of each segment in milliseconds for analysis (default: 100)

***

### showNotification?

> `optional` **showNotification?**: `boolean`

Defined in: [src/AudioStudio.types.ts:446](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L446)

Show a notification during recording (default is false)

***

### showWaveformInNotification?

> `optional` **showWaveformInNotification?**: `boolean`

Defined in: [src/AudioStudio.types.ts:449](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L449)

Show waveform in the notification (Android only, when showNotification is true)

***

### streamFormat?

> `optional` **streamFormat?**: `"float32"` \| `"raw"`

Defined in: [src/AudioStudio.types.ts:582](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L582)

Format for the audio stream data delivered to `onAudioStream`.

- `'raw'` (default): base64-encoded PCM bytes on native, Float32Array on web
- `'float32'`: Float32Array with samples in [-1, 1] on all platforms.
  Eliminates base64 encode/decode overhead on the native bridge.
  Android (new arch): delivered as Float32Array via JSI.
  iOS: delivered as regular Array&lt;number&gt;, normalized to Float32Array in JS.

#### Default

```ts
'raw'
```

***

### web?

> `optional` **web?**: [`WebConfig`](WebConfig.md)

Defined in: [src/AudioStudio.types.ts:475](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L475)

Web-specific configuration options
