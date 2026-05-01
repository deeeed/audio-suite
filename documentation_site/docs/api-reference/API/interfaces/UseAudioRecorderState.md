[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / UseAudioRecorderState

# Interface: UseAudioRecorderState

Defined in: [src/AudioStudio.types.ts:654](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L654)

## Properties

### analysisData?

> `optional` **analysisData**: [`AudioAnalysis`](AudioAnalysis.md)

Defined in: [src/AudioStudio.types.ts:714](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L714)

Analysis data for the recording if processing was enabled

***

### compression?

> `optional` **compression**: [`CompressionInfo`](CompressionInfo.md)

Defined in: [src/AudioStudio.types.ts:712](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L712)

Information about compression if enabled

***

### durationMs

> **durationMs**: `number`

Defined in: [src/AudioStudio.types.ts:708](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L708)

Duration of the current recording in milliseconds

***

### isPaused

> **isPaused**: `boolean`

Defined in: [src/AudioStudio.types.ts:706](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L706)

Indicates whether recording is in a paused state

***

### isRecording

> **isRecording**: `boolean`

Defined in: [src/AudioStudio.types.ts:704](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L704)

Indicates whether recording is currently active

***

### onRecordingInterrupted()?

> `optional` **onRecordingInterrupted**: (`_`) => `void`

Defined in: [src/AudioStudio.types.ts:716](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L716)

Optional callback to handle recording interruptions

#### Parameters

##### \_

[`RecordingInterruptionEvent`](RecordingInterruptionEvent.md)

#### Returns

`void`

***

### pauseRecording()

> **pauseRecording**: () => `Promise`\<`void`\>

Defined in: [src/AudioStudio.types.ts:700](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L700)

Pauses the current recording

#### Returns

`Promise`\<`void`\>

***

### prepareRecording()

> **prepareRecording**: (`_`) => `Promise`\<`void`\>

Defined in: [src/AudioStudio.types.ts:694](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L694)

Prepares recording with the specified configuration without starting it.

This method eliminates the latency between calling startRecording and the actual recording beginning.
It pre-initializes all audio resources, requests permissions, and sets up audio sessions in advance,
allowing for true zero-latency recording start when startRecording is called later.

Technical benefits:
- Eliminates audio pipeline initialization delay (50-300ms depending on platform)
- Pre-allocates audio buffers to avoid memory allocation during recording start
- Initializes audio hardware in advance (particularly important on iOS)
- Requests and verifies permissions before the critical recording moment

Use this method when:
- You need zero-latency recording start (e.g., voice commands, musical applications)
- You're building time-sensitive applications where missing initial audio would be problematic
- You want to prepare resources during app initialization, screen loading, or preceding user interaction
- You need to ensure recording starts reliably and instantly on all platforms

#### Parameters

##### \_

[`RecordingConfig`](RecordingConfig.md)

#### Returns

`Promise`\<`void`\>

A promise that resolves when preparation is complete

#### Example

```ts
// Prepare during component mounting
useEffect(() => {
  prepareRecording({
    sampleRate: 44100,
    channels: 1,
    encoding: 'pcm_16bit',
  });
}, []);

// Later when user taps record button, it starts with zero latency
const handleRecordPress = () => startRecording({
  sampleRate: 44100,
  channels: 1,
  encoding: 'pcm_16bit',
});
```

***

### resumeRecording()

> **resumeRecording**: () => `Promise`\<`void`\>

Defined in: [src/AudioStudio.types.ts:702](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L702)

Resumes a paused recording

#### Returns

`Promise`\<`void`\>

***

### size

> **size**: `number`

Defined in: [src/AudioStudio.types.ts:710](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L710)

Size of the recorded audio in bytes

***

### startRecording()

> **startRecording**: (`_`) => `Promise`\<[`StartRecordingResult`](StartRecordingResult.md)\>

Defined in: [src/AudioStudio.types.ts:696](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L696)

Starts recording with the specified configuration

#### Parameters

##### \_

[`RecordingConfig`](RecordingConfig.md)

#### Returns

`Promise`\<[`StartRecordingResult`](StartRecordingResult.md)\>

***

### stopRecording()

> **stopRecording**: () => `Promise`\<`null` \| [`AudioRecording`](AudioRecording.md)\>

Defined in: [src/AudioStudio.types.ts:698](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L698)

Stops the current recording and returns the recording data

#### Returns

`Promise`\<`null` \| [`AudioRecording`](AudioRecording.md)\>
