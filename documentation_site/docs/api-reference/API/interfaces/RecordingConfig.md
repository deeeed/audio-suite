[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / RecordingConfig

# Interface: RecordingConfig

Defined in: [src/AudioStudio.types.ts:393](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L393)

## Properties

### android?

> `optional` **android**: [`AndroidConfig`](AndroidConfig.md)

Defined in: [src/AudioStudio.types.ts:453](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L453)

Android-specific configuration

***

### autoResumeAfterInterruption?

> `optional` **autoResumeAfterInterruption**: `boolean`

Defined in: [src/AudioStudio.types.ts:482](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L482)

Whether to automatically resume recording after an interruption (default is false)

***

### bufferDurationSeconds?

> `optional` **bufferDurationSeconds**: `number`

Defined in: [src/AudioStudio.types.ts:512](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L512)

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

> `optional` **channels**: `1` \| `2`

Defined in: [src/AudioStudio.types.ts:398](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L398)

Number of audio channels (1 for mono, 2 for stereo)

***

### deviceDisconnectionBehavior?

> `optional` **deviceDisconnectionBehavior**: [`DeviceDisconnectionBehaviorType`](../type-aliases/DeviceDisconnectionBehaviorType.md)

Defined in: [src/AudioStudio.types.ts:496](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L496)

How to handle device disconnection during recording

***

### deviceId?

> `optional` **deviceId**: `string`

Defined in: [src/AudioStudio.types.ts:493](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L493)

ID of the device to use for recording (if not specified, uses default)

***

### enableProcessing?

> `optional` **enableProcessing**: `boolean`

Defined in: [src/AudioStudio.types.ts:436](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L436)

Enable audio processing (default is false)

***

### encoding?

> `optional` **encoding**: [`EncodingType`](../type-aliases/EncodingType.md)

Defined in: [src/AudioStudio.types.ts:415](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L415)

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

> `optional` **features**: [`AudioFeaturesOptions`](AudioFeaturesOptions.md)

Defined in: [src/AudioStudio.types.ts:462](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L462)

Feature options to extract during audio processing

***

### filename?

> `optional` **filename**: `string`

Defined in: [src/AudioStudio.types.ts:490](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L490)

Optional filename for the recording (uses UUID if not provided)

***

### interval?

> `optional` **interval**: `number`

Defined in: [src/AudioStudio.types.ts:418](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L418)

Interval in milliseconds at which to emit recording data (minimum: 10ms)

***

### intervalAnalysis?

> `optional` **intervalAnalysis**: `number`

Defined in: [src/AudioStudio.types.ts:421](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L421)

Interval in milliseconds at which to emit analysis data (minimum: 10ms)

***

### ios?

> `optional` **ios**: [`IOSConfig`](IOSConfig.md)

Defined in: [src/AudioStudio.types.ts:450](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L450)

iOS-specific configuration

***

### keepAwake?

> `optional` **keepAwake**: `boolean`

Defined in: [src/AudioStudio.types.ts:424](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L424)

Keep the device awake while recording (default is false)

***

### keepFullAnalysis?

> `optional` **keepFullAnalysis**: `boolean`

Defined in: [src/AudioStudio.types.ts:447](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L447)

Whether `useAudioRecorder` should retain every audio-analysis data point
and attach the full history to `stopRecording().analysisData`.

Defaults to `true` for backwards compatibility. Set to `false` for
long-running recordings when you only need live `analysisData` state or
per-callback `onAudioAnalysis` chunks; this avoids unbounded JS memory
growth in the hook without disabling native analysis processing.

***

### notification?

> `optional` **notification**: [`NotificationConfig`](NotificationConfig.md)

Defined in: [src/AudioStudio.types.ts:433](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L433)

Configuration for the notification

***

### onAudioAnalysis()?

> `optional` **onAudioAnalysis**: (`_`) => `Promise`\<`void`\>

Defined in: [src/AudioStudio.types.ts:468](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L468)

Callback function to handle audio features extraction results

#### Parameters

##### \_

`AudioAnalysisEvent`

#### Returns

`Promise`\<`void`\>

***

### onAudioStream()?

> `optional` **onAudioStream**: (`_`) => `Promise`\<`void`\>

Defined in: [src/AudioStudio.types.ts:465](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L465)

Callback function to handle audio stream data

#### Parameters

##### \_

[`AudioDataEvent`](../type-aliases/AudioDataEvent.md)

#### Returns

`Promise`\<`void`\>

***

### onRecordingInterrupted()?

> `optional` **onRecordingInterrupted**: (`_`) => `void`

Defined in: [src/AudioStudio.types.ts:485](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L485)

Optional callback to handle recording interruptions

#### Parameters

##### \_

[`RecordingInterruptionEvent`](RecordingInterruptionEvent.md)

#### Returns

`void`

***

### output?

> `optional` **output**: [`OutputConfig`](OutputConfig.md)

Defined in: [src/AudioStudio.types.ts:479](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L479)

Configuration for audio output files

Examples:
- Primary only (default): `{ primary: { enabled: true } }`
- Compressed only: `{ primary: { enabled: false }, compressed: { enabled: true, format: 'aac' } }`
- Both outputs: `{ compressed: { enabled: true } }`
- Streaming only: `{ primary: { enabled: false } }`

***

### outputDirectory?

> `optional` **outputDirectory**: `string`

Defined in: [src/AudioStudio.types.ts:488](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L488)

Optional directory path where output files will be saved

***

### sampleRate?

> `optional` **sampleRate**: [`SampleRate`](../type-aliases/SampleRate.md)

Defined in: [src/AudioStudio.types.ts:395](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L395)

Sample rate for recording in Hz (16000, 44100, or 48000)

***

### segmentDurationMs?

> `optional` **segmentDurationMs**: `number`

Defined in: [src/AudioStudio.types.ts:459](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L459)

Duration of each segment in milliseconds for analysis (default: 100)

***

### showNotification?

> `optional` **showNotification**: `boolean`

Defined in: [src/AudioStudio.types.ts:427](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L427)

Show a notification during recording (default is false)

***

### showWaveformInNotification?

> `optional` **showWaveformInNotification**: `boolean`

Defined in: [src/AudioStudio.types.ts:430](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L430)

Show waveform in the notification (Android only, when showNotification is true)

***

### streamFormat?

> `optional` **streamFormat**: `"float32"` \| `"raw"`

Defined in: [src/AudioStudio.types.ts:525](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L525)

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

> `optional` **web**: [`WebConfig`](WebConfig.md)

Defined in: [src/AudioStudio.types.ts:456](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L456)

Web-specific configuration options
