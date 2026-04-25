[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / RecordingConfig

# Interface: RecordingConfig

Defined in: [src/AudioStudio.types.ts:390](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L390)

## Properties

### android?

> `optional` **android**: [`AndroidConfig`](AndroidConfig.md)

Defined in: [src/AudioStudio.types.ts:439](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L439)

Android-specific configuration

***

### autoResumeAfterInterruption?

> `optional` **autoResumeAfterInterruption**: `boolean`

Defined in: [src/AudioStudio.types.ts:468](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L468)

Whether to automatically resume recording after an interruption (default is false)

***

### bufferDurationSeconds?

> `optional` **bufferDurationSeconds**: `number`

Defined in: [src/AudioStudio.types.ts:498](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L498)

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

Defined in: [src/AudioStudio.types.ts:395](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L395)

Number of audio channels (1 for mono, 2 for stereo)

***

### deviceDisconnectionBehavior?

> `optional` **deviceDisconnectionBehavior**: [`DeviceDisconnectionBehaviorType`](../type-aliases/DeviceDisconnectionBehaviorType.md)

Defined in: [src/AudioStudio.types.ts:482](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L482)

How to handle device disconnection during recording

***

### deviceId?

> `optional` **deviceId**: `string`

Defined in: [src/AudioStudio.types.ts:479](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L479)

ID of the device to use for recording (if not specified, uses default)

***

### enableProcessing?

> `optional` **enableProcessing**: `boolean`

Defined in: [src/AudioStudio.types.ts:433](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L433)

Enable audio processing (default is false)

***

### encoding?

> `optional` **encoding**: [`EncodingType`](../type-aliases/EncodingType.md)

Defined in: [src/AudioStudio.types.ts:412](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L412)

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

Defined in: [src/AudioStudio.types.ts:448](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L448)

Feature options to extract during audio processing

***

### filename?

> `optional` **filename**: `string`

Defined in: [src/AudioStudio.types.ts:476](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L476)

Optional filename for the recording (uses UUID if not provided)

***

### interval?

> `optional` **interval**: `number`

Defined in: [src/AudioStudio.types.ts:415](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L415)

Interval in milliseconds at which to emit recording data (minimum: 10ms)

***

### intervalAnalysis?

> `optional` **intervalAnalysis**: `number`

Defined in: [src/AudioStudio.types.ts:418](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L418)

Interval in milliseconds at which to emit analysis data (minimum: 10ms)

***

### ios?

> `optional` **ios**: [`IOSConfig`](IOSConfig.md)

Defined in: [src/AudioStudio.types.ts:436](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L436)

iOS-specific configuration

***

### keepAwake?

> `optional` **keepAwake**: `boolean`

Defined in: [src/AudioStudio.types.ts:421](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L421)

Keep the device awake while recording (default is false)

***

### notification?

> `optional` **notification**: [`NotificationConfig`](NotificationConfig.md)

Defined in: [src/AudioStudio.types.ts:430](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L430)

Configuration for the notification

***

### onAudioAnalysis()?

> `optional` **onAudioAnalysis**: (`_`) => `Promise`\<`void`\>

Defined in: [src/AudioStudio.types.ts:454](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L454)

Callback function to handle audio features extraction results

#### Parameters

##### \_

`AudioAnalysisEvent`

#### Returns

`Promise`\<`void`\>

***

### onAudioStream()?

> `optional` **onAudioStream**: (`_`) => `Promise`\<`void`\>

Defined in: [src/AudioStudio.types.ts:451](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L451)

Callback function to handle audio stream data

#### Parameters

##### \_

[`AudioDataEvent`](../type-aliases/AudioDataEvent.md)

#### Returns

`Promise`\<`void`\>

***

### onRecordingInterrupted()?

> `optional` **onRecordingInterrupted**: (`_`) => `void`

Defined in: [src/AudioStudio.types.ts:471](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L471)

Optional callback to handle recording interruptions

#### Parameters

##### \_

[`RecordingInterruptionEvent`](RecordingInterruptionEvent.md)

#### Returns

`void`

***

### output?

> `optional` **output**: [`OutputConfig`](OutputConfig.md)

Defined in: [src/AudioStudio.types.ts:465](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L465)

Configuration for audio output files

Examples:
- Primary only (default): `{ primary: { enabled: true } }`
- Compressed only: `{ primary: { enabled: false }, compressed: { enabled: true, format: 'aac' } }`
- Both outputs: `{ compressed: { enabled: true } }`
- Streaming only: `{ primary: { enabled: false } }`

***

### outputDirectory?

> `optional` **outputDirectory**: `string`

Defined in: [src/AudioStudio.types.ts:474](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L474)

Optional directory path where output files will be saved

***

### sampleRate?

> `optional` **sampleRate**: [`SampleRate`](../type-aliases/SampleRate.md)

Defined in: [src/AudioStudio.types.ts:392](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L392)

Sample rate for recording in Hz (16000, 44100, or 48000)

***

### segmentDurationMs?

> `optional` **segmentDurationMs**: `number`

Defined in: [src/AudioStudio.types.ts:445](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L445)

Duration of each segment in milliseconds for analysis (default: 100)

***

### showNotification?

> `optional` **showNotification**: `boolean`

Defined in: [src/AudioStudio.types.ts:424](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L424)

Show a notification during recording (default is false)

***

### showWaveformInNotification?

> `optional` **showWaveformInNotification**: `boolean`

Defined in: [src/AudioStudio.types.ts:427](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L427)

Show waveform in the notification (Android only, when showNotification is true)

***

### streamFormat?

> `optional` **streamFormat**: `"float32"` \| `"raw"`

Defined in: [src/AudioStudio.types.ts:511](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L511)

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

Defined in: [src/AudioStudio.types.ts:442](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L442)

Web-specific configuration options
