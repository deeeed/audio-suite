[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / StreamAudioDataChunk

# Interface: StreamAudioDataChunk

Defined in: [src/streamAudioData.ts:53](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L53)

## Properties

### channels

> **channels**: `number`

Defined in: [src/streamAudioData.ts:71](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L71)

Output channel count.

***

### chunkIndex

> **chunkIndex**: `number`

Defined in: [src/streamAudioData.ts:57](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L57)

Zero-based monotonic chunk index.

***

### durationMs

> **durationMs**: `number`

Defined in: [src/streamAudioData.ts:63](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L63)

Duration in ms (`endTimeMs - startTimeMs`).

***

### endTimeMs

> **endTimeMs**: `number`

Defined in: [src/streamAudioData.ts:61](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L61)

End time in output-rate ms.

***

### isFinal

> **isFinal**: `boolean`

Defined in: [src/streamAudioData.ts:75](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L75)

True for the last chunk of a non-cancelled run.

***

### requestId

> **requestId**: `string`

Defined in: [src/streamAudioData.ts:55](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L55)

Native request id; constant across all chunks of one call.

***

### sampleCount

> **sampleCount**: `number`

Defined in: [src/streamAudioData.ts:67](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L67)

Sample count in `samples` (interleaved if channels > 1).

***

### sampleRate

> **sampleRate**: `number`

Defined in: [src/streamAudioData.ts:69](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L69)

Output sample rate.

***

### samples

> **samples**: `Float32Array`

Defined in: [src/streamAudioData.ts:73](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L73)

Interleaved Float32 samples in [-1, 1].

***

### startSample

> **startSample**: `number`

Defined in: [src/streamAudioData.ts:65](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L65)

First sample index in the output timeline.

***

### startTimeMs

> **startTimeMs**: `number`

Defined in: [src/streamAudioData.ts:59](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L59)

Start time in output-rate ms (rounded to nearest sample).
