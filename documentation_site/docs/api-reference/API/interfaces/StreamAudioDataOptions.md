[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / StreamAudioDataOptions

# Interface: StreamAudioDataOptions

Defined in: [src/streamAudioData.ts:18](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L18)

High-level API: stream decoded audio from a stored file as bounded Float32
chunks without materializing the full PCM range in memory.

See `docs/STREAM_AUDIO_DATA.md` for the full contract and rollout notes.

## Properties

### backpressureTimeoutMs?

> `optional` **backpressureTimeoutMs?**: `number`

Defined in: [src/streamAudioData.ts:46](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L46)

Optional timeout for a chunk acknowledgement while backpressure is active.
Undefined/0 disables timeout so long transcription callbacks can run.

***

### channels?

> `optional` **channels?**: `number`

Defined in: [src/streamAudioData.ts:33](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L33)

Output channel count (1 = mono downmix, 2 = stereo passthrough).

***

### chunkDurationMs?

> `optional` **chunkDurationMs?**: `number`

Defined in: [src/streamAudioData.ts:37](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L37)

Target chunk duration in ms (default: 1000, min: 10, max: 60000).

***

### endTimeMs?

> `optional` **endTimeMs?**: `number`

Defined in: [src/streamAudioData.ts:24](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L24)

End time in milliseconds (default: end-of-file).

***

### fileUri

> **fileUri**: `string`

Defined in: [src/streamAudioData.ts:20](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L20)

URI of the audio file to decode.

***

### maxBufferedChunks?

> `optional` **maxBufferedChunks?**: `number`

Defined in: [src/streamAudioData.ts:41](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L41)

Max chunks queued in native before JS ack pauses decode (default: 4).

***

### maxChunkBytes?

> `optional` **maxChunkBytes?**: `number`

Defined in: [src/streamAudioData.ts:39](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L39)

Soft cap on chunk size in bytes (Float32 = 4 bytes/sample).

***

### normalizeAudio?

> `optional` **normalizeAudio?**: `boolean`

Defined in: [src/streamAudioData.ts:35](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L35)

Clamp samples to [-1, 1] and replace non-finite values with 0.

***

### sampleRate?

> `optional` **sampleRate?**: `number`

Defined in: [src/streamAudioData.ts:29](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L29)

Source sample rate hint. Ignored if `targetSampleRate` is set; native
decoders read the actual rate from the file.

***

### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [src/streamAudioData.ts:50](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L50)

Abort the in-flight request. Resolves promise with `cancelled: true`.

***

### startTimeMs?

> `optional` **startTimeMs?**: `number`

Defined in: [src/streamAudioData.ts:22](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L22)

Start time in milliseconds (default: 0).

***

### streamFormat?

> `optional` **streamFormat?**: `"float32"`

Defined in: [src/streamAudioData.ts:48](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L48)

Output PCM format; only `'float32'` supported today.

***

### targetSampleRate?

> `optional` **targetSampleRate?**: `number`

Defined in: [src/streamAudioData.ts:31](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L31)

Output sample rate. Native resamples when this differs from the file.
