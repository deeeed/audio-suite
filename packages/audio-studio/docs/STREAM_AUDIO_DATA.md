# streamAudioData — progressive file decode

`streamAudioData` decodes a stored audio file into bounded Float32 PCM chunks
without loading the full recording into memory. It is the long-form companion
to `extractAudioData` (which materializes a bounded PCM range as a single
result).

Use `streamAudioData` when:

- you process recordings whose length is unbounded (e.g. meeting captures,
  podcasts, long voice notes),
- you feed an on-device ML pipeline that consumes PCM frames progressively
  (speech-to-text, VAD, diarization, embeddings, waveform/preview generation),
- you need cancellation, progress, or back-pressure that a single-shot
  `extractAudioData` call cannot give you.

Keep using `extractAudioData` for small bounded extractions where you want one
buffer back.

## API

```ts
import {
    streamAudioData,
    getAudioDecodeCapabilities,
    AudioStreamError,
} from '@siteed/audio-studio'

const result = await streamAudioData(
    {
        fileUri,
        targetSampleRate: 16000,
        channels: 1,
        streamFormat: 'float32',
        chunkDurationMs: 250,
        normalizeAudio: true,
        maxBufferedChunks: 4,
        signal: controller.signal,
    },
    {
        onChunk: async ({ samples, startTimeMs, endTimeMs, isFinal }) => {
            await transcriber.addAudio(samples)
        },
        onProgress: ({ processedMs, durationMs }) => {
            updateProgress(processedMs / durationMs)
        },
    }
)
```

### Options

| Field                   | Default   | Notes                                                                     |
| ----------------------- | --------- | ------------------------------------------------------------------------- |
| `fileUri`               | —         | Required. `file://`, absolute path, or `content://` (Android).            |
| `startTimeMs`           | `0`       | Inclusive start in ms.                                                    |
| `endTimeMs`             | EOF       | Exclusive end in ms.                                                      |
| `targetSampleRate`      | source    | Output rate. Native resamples on iOS/Android, OfflineAudioContext on web. |
| `channels`              | source    | `1` for mono downmix, `2` for stereo pass-through.                        |
| `normalizeAudio`        | `true`    | Clamp to `[-1, 1]`. Always replaces non-finite samples with `0`.          |
| `chunkDurationMs`       | `1000`    | Range `[10, 60000]`.                                                      |
| `maxChunkBytes`         | —         | Hard cap; chunks may be split smaller.                                    |
| `maxBufferedChunks`     | `4`       | Native pauses decode after this many chunks are unacked.                  |
| `backpressureTimeoutMs` | `0`/off   | Optional native ack timeout while paused for JS backpressure.             |
| `streamFormat`          | `float32` | Only `'float32'` is supported today.                                      |
| `signal`                | —         | `AbortSignal`. Aborting resolves with `cancelled: true`.                  |

### Chunk shape

```ts
{
    requestId: string
    chunkIndex: number // monotonic 0,1,2,...
    startTimeMs: number // absolute, range start + offset
    endTimeMs: number // absolute, range start + offset
    durationMs: number
    startSample: number // in the output sample-rate timeline
    sampleCount: number
    sampleRate: number
    channels: number
    samples: Float32Array // interleaved
    isFinal: boolean
}
```

`startTimeMs` / `endTimeMs` on chunks are absolute timestamps in the source
file's timeline (i.e. `options.startTimeMs + offset_into_range`). Progress
callbacks (`onProgress.processedMs`) report **elapsed** time within the
requested range so `processedMs / durationMs` is always in `[0, 1]`.

A terminal chunk with `sampleCount: 0` and `isFinal: true` is emitted on
iOS/Android when the decoded range ends exactly on a chunk boundary or no
samples are emitted, so consumers that key off `isFinal` always see
termination. Web suppresses the empty tail and instead marks the last
data-bearing chunk as final.

### Errors

Reject with `AudioStreamError`. Stable codes:

- `ERR_AUDIO_STREAM_UNSUPPORTED_FORMAT`
- `ERR_AUDIO_STREAM_INVALID_RANGE`
- `ERR_AUDIO_STREAM_DECODE_FAILED`
- `ERR_AUDIO_STREAM_CANCELLED` _(resolves rather than rejects)_
- `ERR_AUDIO_STREAM_PERMISSION_DENIED`
- `ERR_AUDIO_STREAM_FILE_NOT_FOUND`
- `ERR_AUDIO_STREAM_BACKPRESSURE_TIMEOUT`
- `ERR_AUDIO_STREAM_NATIVE_UNAVAILABLE`
- `ERR_AUDIO_STREAM_BUSY`
- `ERR_AUDIO_STREAM_UNKNOWN`

`AudioStreamError.recoverable` flags codes a UI can retry without intervention
(cancellation, busy, backpressure timeout, permission denied).

### Capabilities

```ts
const caps = await getAudioDecodeCapabilities()
// {
//   platform: 'ios' | 'android' | 'web',
//   supportedInputFormats: [...],
//   supportedOutputFormats: ['float32'],
//   supportsCancellation: true,
//   supportsBackpressure: true,
//   supportsTimeRange: true,
//   supportsTargetSampleRate: true,
//   supportsChannelMixing: true,
//   knownLimitations: [...],
// }
```

## Back-pressure

If `onChunk` returns a promise, the JS wrapper waits for it to resolve before
acking the chunk back to native. Native pauses decoding once
`emittedChunks - lastAckedChunk >= maxBufferedChunks`. This caps memory at
roughly `chunkDurationMs * sampleRate * channels * 4 * maxBufferedChunks` plus
the platform decoder's own buffers.

If `backpressureTimeoutMs` is a positive number and native stays paused longer
than that waiting for JS to ack a chunk, native aborts the stream with
`ERR_AUDIO_STREAM_BACKPRESSURE_TIMEOUT`. The default is disabled because some
validation callbacks intentionally run slow transcription work before acking.

If `onChunk` throws, the stream is aborted with
`ERR_AUDIO_STREAM_DECODE_FAILED`.

## Cancellation

Pass an `AbortSignal`. Aborting:

1. Calls `cancelStreamAudioData(requestId)` on the native side.
2. The native decoder breaks out of its loop, releases the codec/extractor, and
   emits a final `AudioDataStreamComplete` event with `cancelled: true`.
3. The wrapper resolves the promise with `cancelled: true` (it does **not**
   reject).

Cancel after completion is a no-op.
