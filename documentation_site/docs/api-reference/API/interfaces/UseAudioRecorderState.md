[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / UseAudioRecorderState

# Interface: UseAudioRecorderState

Defined in: [src/AudioStudio.types.ts:695](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L695)

## Properties

### analysisData?

> `optional` **analysisData?**: [`AudioAnalysis`](AudioAnalysis.md)

Defined in: [src/AudioStudio.types.ts:759](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L759)

Analysis data for the recording if processing was enabled

***

### compression?

> `optional` **compression?**: [`CompressionInfo`](CompressionInfo.md)

Defined in: [src/AudioStudio.types.ts:753](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L753)

Information about compression if enabled

***

### durationMs

> **durationMs**: `number`

Defined in: [src/AudioStudio.types.ts:749](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L749)

Duration of the current recording in milliseconds

***

### isPaused

> **isPaused**: `boolean`

Defined in: [src/AudioStudio.types.ts:747](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L747)

Indicates whether recording is in a paused state

***

### isRecording

> **isRecording**: `boolean`

Defined in: [src/AudioStudio.types.ts:745](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L745)

Indicates whether recording is currently active

***

### maxDurationMs?

> `optional` **maxDurationMs?**: `number`

Defined in: [src/AudioStudio.types.ts:755](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L755)

Configured maximum active recording duration in milliseconds, if enabled

***

### maxDurationReached?

> `optional` **maxDurationReached?**: `boolean`

Defined in: [src/AudioStudio.types.ts:757](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L757)

Whether the current recording session has reached the configured maximum duration

***

### onMaxDurationReached?

> `optional` **onMaxDurationReached?**: (`_`) => `void`

Defined in: [src/AudioStudio.types.ts:763](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L763)

Optional callback invoked when maxDurationMs is reached

#### Parameters

##### \_

[`MaxDurationReachedEvent`](MaxDurationReachedEvent.md)

#### Returns

`void`

***

### onRecordingInterrupted?

> `optional` **onRecordingInterrupted?**: (`_`) => `void`

Defined in: [src/AudioStudio.types.ts:761](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L761)

Optional callback to handle recording interruptions

#### Parameters

##### \_

[`RecordingInterruptionEvent`](RecordingInterruptionEvent.md)

#### Returns

`void`

***

### pauseRecording

> **pauseRecording**: () => `Promise`\<`void`\>

Defined in: [src/AudioStudio.types.ts:741](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L741)

Pauses the current recording

#### Returns

`Promise`\<`void`\>

***

### prepareRecording

> **prepareRecording**: (`_`) => `Promise`\<`void`\>

Defined in: [src/AudioStudio.types.ts:735](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L735)

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

### resumeRecording

> **resumeRecording**: () => `Promise`\<`void`\>

Defined in: [src/AudioStudio.types.ts:743](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L743)

Resumes a paused recording

#### Returns

`Promise`\<`void`\>

***

### size

> **size**: `number`

Defined in: [src/AudioStudio.types.ts:751](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L751)

Size of the recorded audio in bytes

***

### startRecording

> **startRecording**: (`_`) => `Promise`\<[`StartRecordingResult`](StartRecordingResult.md)\>

Defined in: [src/AudioStudio.types.ts:737](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L737)

Starts recording with the specified configuration

#### Parameters

##### \_

[`RecordingConfig`](RecordingConfig.md)

#### Returns

`Promise`\<[`StartRecordingResult`](StartRecordingResult.md)\>

***

### stopRecording

> **stopRecording**: () => `Promise`\<[`AudioRecording`](AudioRecording.md) \| `null`\>

Defined in: [src/AudioStudio.types.ts:739](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L739)

Stops the current recording and returns the recording data

#### Returns

`Promise`\<[`AudioRecording`](AudioRecording.md) \| `null`\>
