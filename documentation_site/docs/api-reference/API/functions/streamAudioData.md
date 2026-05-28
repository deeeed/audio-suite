[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / streamAudioData

# Function: streamAudioData()

> **streamAudioData**(`options`, `callbacks`): `Promise`\<[`StreamAudioDataResult`](../interfaces/StreamAudioDataResult.md)\>

Defined in: [src/streamAudioData.ts:291](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/streamAudioData.ts#L291)

Stream decoded audio from a stored file as bounded Float32 PCM chunks.

Memory bound:
  `chunkDurationMs * sampleRate * channels * 4 * maxBufferedChunks` +
  native decoder buffers.

Cancellation: pass `options.signal` and call `abort()`. The returned promise
resolves with `cancelled: true` (it does not reject) when cancellation wins.

Backpressure: if `onChunk` returns a Promise, native decode is paused until
it resolves; if it throws, the stream is aborted with a `decode_failed` error.

## Parameters

### options

[`StreamAudioDataOptions`](../interfaces/StreamAudioDataOptions.md)

### callbacks

[`StreamAudioDataCallbacks`](../interfaces/StreamAudioDataCallbacks.md)

## Returns

`Promise`\<[`StreamAudioDataResult`](../interfaces/StreamAudioDataResult.md)\>
