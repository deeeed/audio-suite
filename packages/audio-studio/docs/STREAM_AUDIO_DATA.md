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

## Long-recording validation harness

The `@siteed/audio-studio` workspace includes a CDP/ADB harness for validating
real long compressed files on a physical Android device. The fixture can be
Opus, MP3, AAC/M4A, or any other compressed format supported by the platform
decoder; pass it with `--fixture` or `AUDIO_FIXTURE`. Start the playground
with the package script (this intentionally targets a connected device, not an
emulator):

```bash
cd /Volumes/c910ssd/dev/audiolab/packages/audio-studio
yarn android:device
```

Then run the 100-minute Opus fixture. To exercise the same long recording
through MP3 and AAC/M4A platform decoders, derive those fixtures from the Opus
source with `ffmpeg`:

```bash
ffmpeg -y -i /Volumes/c910ssd/dev/audiolab/.agent/fixtures/perps_controller_refactor_100m.opus \
  -vn -ac 1 -ar 16000 -c:a libmp3lame -b:a 48k \
  /Volumes/c910ssd/dev/audiolab/.agent/fixtures/perps_controller_refactor_100m.mp3

ffmpeg -y -i /Volumes/c910ssd/dev/audiolab/.agent/fixtures/perps_controller_refactor_100m.opus \
  -vn -ac 1 -ar 16000 -c:a aac -b:a 48k \
  /Volumes/c910ssd/dev/audiolab/.agent/fixtures/perps_controller_refactor_100m.m4a
```

Use the same validation commands below with the `.opus`, `.mp3`, or `.m4a`
fixture path. The full Qwen3 transcription proof currently uses Opus; MP3 and
AAC/M4A are covered by full-length decode proofs plus short Qwen3
decode/transcribe smokes because, after platform decode, all three formats feed
the same 16 kHz mono PCM transcription path.

Run the fixture:

```bash
# Decode only: proves audio-studio does not retain decoded PCM over time.
ANDROID_SERIAL=<device-serial> \
  yarn validate:stream-long --platform android --decode-only \
  --fixture /Volumes/c910ssd/dev/audiolab/.agent/fixtures/perps_controller_refactor_100m.opus

# Decode + Moonshine: fail clearly before the app reaches unsafe memory.
ANDROID_SERIAL=<device-serial> \
  yarn validate:stream-long --platform android --moonshine \
  --fixture /Volumes/c910ssd/dev/audiolab/.agent/fixtures/perps_controller_refactor_100m.opus \
  --max-pss-kb 1200000 \
  --max-native-heap-kb 650000

# Full-buffer control: intentionally compares the legacy whole-file decode path.
# This may disconnect the debugger or exceed device-safe memory on long files.
ANDROID_SERIAL=<device-serial> \
  yarn validate:stream-long --platform android --full-decode \
  --fixture /Volumes/c910ssd/dev/audiolab/.agent/fixtures/perps_controller_refactor_100m.opus

# Decode + Sherpa ONNX Qwen3-ASR: Qwen3 is offline-only in the current
# Sherpa ONNX RN API, so validate it by feeding bounded decoded segments.
# If `apps/sherpa-voice` already downloaded the Qwen3 model on the same
# Android device, copy that sandbox model into the playground sandbox while
# starting the first run:
ANDROID_SERIAL=<device-serial> \
  yarn validate:stream-long --platform android --sherpa-offline-segments \
  --fixture /Volumes/c910ssd/dev/audiolab/.agent/fixtures/perps_controller_refactor_100m.opus \
  --sherpa-config ./scripts/qwen3-asr-playground-config.json \
  --stage-sherpa-model-from 'net.siteed.sherpavoice.development:/data/user/0/net.siteed.sherpavoice.development/files/models/qwen3-asr-0.6B-int8-2026-03-25/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25' \
  --limit-ms 30000

# Optional 5-minute stress benchmark (one segment). On Pixel 6a-class devices
# this can kill the app under memory pressure; the default 30-second segment is
# the reproducible Qwen3 path today.
ANDROID_SERIAL=<device-serial> \
  yarn validate:stream-long --platform android --sherpa-offline-segments \
  --fixture /Volumes/c910ssd/dev/audiolab/.agent/fixtures/perps_controller_refactor_100m.opus \
  --sherpa-config ./scripts/qwen3-asr-playground-config.json \
  --sherpa-segment-duration-ms 300000 \
  --limit-ms 300000

# Then run the full long fixture with the safe default 30-second segment size
# and compare wall time, transcript size, and memory JSONL rows against the
# short run.
ANDROID_SERIAL=<device-serial> \
  yarn validate:stream-long --platform android --sherpa-offline-segments \
  --fixture /Volumes/c910ssd/dev/audiolab/.agent/fixtures/perps_controller_refactor_100m.opus \
  --sherpa-config ./scripts/qwen3-asr-playground-config.json

# Decode + Sherpa ONNX online ASR: requires a streaming-capable Sherpa model
# already staged on-device and described by an AsrModelConfig JSON file.
# Do not point this at Qwen3-ASR; use --sherpa-offline-segments instead.
ANDROID_SERIAL=<device-serial> \
  yarn validate:stream-long --platform android --sherpa-online \
  --fixture /Volumes/c910ssd/dev/audiolab/.agent/fixtures/perps_controller_refactor_100m.opus \
  --sherpa-config /path/to/sherpa-online-asr-config.json
```

The script prints JSONL rows (`start`, `fixture-staged`, `progress`, `final`,
`budget-exceeded`, `error`) with wall time, processed audio time, emitted chunk
count, transcript size, and Android `dumpsys meminfo` totals when available.
Relative fixture paths are resolved from the current directory first, then the
repo root.

If both Android and iOS agentic devices are visible, pass `--platform` and/or
`--device` so CDP evaluation is not broadcast. The default platform is Android
for compatibility with the memory-budget checks.

For iOS simulator decode validation, build and launch the playground, then
target the simulator by name. The harness copies the host fixture into the
simulator app data container and passes a `file://` URI into
`streamAudioData()`:

```bash
cd /Volumes/c910ssd/dev/audiolab/packages/audio-studio
yarn test:ios
LONG_AUDIO_PLATFORM=ios \
  yarn validate:stream-long --platform ios --device playground-1 --decode-only \
  --fixture /Volumes/c910ssd/dev/audiolab/.agent/fixtures/perps_controller_refactor_100m.opus \
  --limit-ms 10000
```

iOS simulator runs currently report progress and completion, but process and
memory sampling are marked unsupported in JSONL (`memory sampling is currently
Android/ADB-only`). iOS physical fixture staging is not implemented in this
headless harness yet.

Summarize one or more JSONL runs into a benchmark table:

```bash
yarn summarize:stream-long --markdown \
  ../../.agent/validation-logs/validate-stream-long-android-qwen3-*.jsonl
```

Use `--csv` for spreadsheets or `--json` for downstream tooling. The summary
includes terminal status, mode/model, processed audio duration, wall time,
chunks, Sherpa segment count, transcript size, peak memory, final memory, and
error reason.

Physical-device evidence collected for
`perps_controller_refactor_100m.opus` (100:24 / 6,024,404 ms, 18.8 MB):

- Decode-only completed the full file with `targetSampleRate: 16000`,
  `channels: 1`, `chunkDurationMs: 250`, and `maxBufferedChunks: 4`.
  It emitted 24,098 chunks / 96,390,680 samples in ~6.1 minutes on the latest
  targeted harness run (`validate-stream-long-android-decode-full-targeted-20260514T023511Z.fixed.jsonl`).
  Final memory was approximately 524 MB total PSS and 127 MB native heap, lower
  than warmup peaks, so the Android decoder path is not growing with recording
  duration.
- MP3 and AAC/M4A derivatives of the same 100-minute fixture also completed
  full Android decode-only validation. The MP3 run
  (`validate-stream-long-android-decode-full-mp3-20260514T051957Z.jsonl`)
  decoded 100:24 / 24,098 chunks / 96,390,464 samples in ~3.7 minutes with
  peak sampled memory ~506 MB total PSS / ~123 MB native heap and final memory
  ~454 MB / ~122 MB. The AAC/M4A run
  (`validate-stream-long-android-decode-full-m4a-20260514T052510Z.jsonl`)
  decoded 100:24 / 24,098 chunks / 96,391,168 samples in ~1.2 minutes with
  peak sampled memory ~479 MB total PSS / ~123 MB native heap and final memory
  ~454 MB / ~122 MB.
- Moonshine feed with streamed chunks emitted transcript progress, but memory
  growth was in the Moonshine path. A 2-minute typed-array Moonshine run
  completed in ~62 seconds (`validate-stream-long-android-moonshine-2min-20260514T025530Z.jsonl`)
  with 481 chunks, 802 transcript chars, 42 transcript lines, and peak sampled
  memory ~1.15 GB total PSS / ~622 MB native heap. A full-fixture Moonshine run
  with safety budgets (`--max-pss-kb 1500000 --max-native-heap-kb 900000`) was
  cancelled by the harness before OOM at 31.7% of the file / 31:47 processed
  audio (`validate-stream-long-android-moonshine-full-budget-20260514T025928Z.jsonl`),
  with peak sampled memory ~1.51 GB total PSS / ~834 MB native heap and 9,872
  transcript chars. The app accepted cancellation and dropped back to ~721 MB
  PSS / ~233 MB native heap afterward. This classifies the long-run risk as
  `moonshine.rn` native streaming/transcript state and/or bridge
  materialization, not `audio-studio` decode retention.
- Sherpa/Qwen3 staging from `apps/sherpa-voice` into the playground sandbox
  completed successfully with
  `--stage-sherpa-model-from net.siteed.sherpavoice.development:.../qwen3...`.
  A 30-second Qwen3 segmented smoke completed (`sherpaSegmentCount: 2`,
  transcript chars: 140). A 2-minute run with 30-second segments completed
  (`sherpaSegmentCount: 5`, transcript chars: 921) but peaked around
  3.17 GB total PSS / 2.77 GB native heap when keeping one ASR instance alive.
  Enabling `--sherpa-release-between-segments` kept the same 2-minute run under
  ~1.54 GB / 1.28 GB at sampled progress points, and a 5-minute run with
  30-second segments completed (`sherpaSegmentCount: 11`, transcript chars: 1882) with final memory ~442 MB / 123 MB. A 10-minute run with the same
  settings completed (`sherpaSegmentCount: 21`, transcript chars: 2114) in
  ~8.5 minutes with peak sampled memory ~2.65 GB / 2.29 GB and final memory
  ~447 MB / 125 MB. The full 100:24 fixture completed with the same 30-second
  segments plus `--sherpa-release-between-segments`
  (`validate-stream-long-android-qwen3-full-30s-release-between-20260514T032814Z.jsonl`):
  201 Sherpa segments, 50,793 transcript chars / 178 lines, 24,098 decoded
  chunks / 96,390,680 samples, ~104.8 minutes harness wall time, peak sampled
  memory ~2.78 GB total PSS / ~2.45 GB native heap, and final memory ~465 MB /
  ~126 MB. A 5-minute single-segment Qwen3 stress run decoded the full
  300-second range but the Android app process died before returning
  transcription; logcat reported the playground process death during memory
  pressure. Treat 5-minute _single_ Qwen3 segments as an explicit stress/control
  case on Pixel 6a-class devices. The reproducible long-run path today is
  smaller segments plus `--sherpa-release-between-segments` until Sherpa RN
  exposes a lower-copy sample/file-segment API.
- MP3 and AAC/M4A also completed short combined Qwen3 decode/transcribe smokes
  using the same 30-second offline-segment path. MP3 produced 144 transcript
  chars from 30 seconds
  (`validate-stream-long-android-qwen3-mp3-30s-20260514T052717Z.jsonl`), and
  AAC/M4A produced 145 transcript chars from 30 seconds
  (`validate-stream-long-android-qwen3-m4a-30s-20260514T052815Z.jsonl`).

`@siteed/moonshine.rn` accepts `Float32Array` at the JS API boundary, but the
legacy React Native bridge still materializes arrays internally before calling
the native module. Treat this as a compatibility improvement, not a zero-copy
JSI/ArrayBuffer path. Until that path exists, keep Moonshine chunks bounded and
run the harness with memory budgets so failures are typed and recoverable.

For interactive validation, open the playground dev page:

```bash
cd /Volumes/c910ssd/dev/audiolab
yarn workspace @siteed/audio-studio android:device
yarn workspace audio-playground recipe:run \
  scripts/agentic/teams/playground/recipes/long-audio-validation.json \
  --device <device-name>
```

The page is available at `/long-audio-validation`. It lets an operator edit the
staged fixture path, choose the Moonshine model id, paste a Sherpa
`AsrModelConfig` JSON object, start decode-only, full-buffer decode, decode +
Moonshine, decode + Sherpa online ASR, or decode + Sherpa/Qwen3 offline
segments, cancel the active job, and watch the same progress object that the
headless harness polls.

Qwen3-ASR config shape matching `apps/sherpa-voice`:

```json
{
    "modelDir": "/data/user/0/<playground-package>/files/sherpa-onnx/asr/qwen3-asr-0.6B-int8-2026-03-25",
    "modelType": "qwen3",
    "streaming": false,
    "numThreads": 4,
    "decodingMethod": "greedy_search",
    "maxActivePaths": 4,
    "provider": "cpu",
    "modelFiles": {
        "encoder": "encoder.int8.onnx",
        "decoder": "decoder.int8.onnx",
        "convFrontend": "conv_frontend.onnx",
        "tokenizer": "tokenizer"
    },
    "qwen3": {
        "maxTotalLen": 512,
        "maxNewTokens": 128,
        "temperature": 0.000001,
        "topP": 0.8,
        "seed": 42
    }
}
```

The model directory above is an Android app-private example path. The Qwen3
archive in `apps/sherpa-voice/src/utils/models.ts` is approximately 614 MB and
must be downloaded/extracted or otherwise staged into the playground app sandbox
before the Qwen3 segment benchmark can run. For the benchmark matrix, use the
same config for:

- smoke transcription: `--sherpa-offline-segments --limit-ms 30000
--sherpa-segment-duration-ms 30000`;
- 5-minute segmented transcription: `--sherpa-offline-segments --limit-ms
300000 --sherpa-segment-duration-ms 30000
--sherpa-release-between-segments`;
- 5-minute single-segment stress comparison: `--sherpa-offline-segments
--limit-ms 300000 --sherpa-segment-duration-ms 300000`;
- full long transcription: `--sherpa-offline-segments
--sherpa-release-between-segments`; keep the default 30-second segments for
  reproducibility on memory-constrained devices, or pass
  `--sherpa-segment-duration-ms 300000` only when intentionally stress-testing;
- decode-only controls: repeat both with `--decode-only`;
- full-buffer decode control: `--full-decode` (expected to be unsafe/opaque on
  the 100-minute fixture and useful mainly as evidence that streaming/ranging is
  necessary).

Minimal Sherpa online config shape:

```json
{
    "modelDir": "/data/user/0/net.siteed.audioplayground.development/files/sherpa-models/<model-dir>",
    "modelType": "zipformer",
    "streaming": true,
    "numThreads": 2,
    "provider": "cpu",
    "modelFiles": {
        "encoder": "encoder.onnx",
        "decoder": "decoder.onnx",
        "joiner": "joiner.onnx",
        "tokens": "tokens.txt"
    }
}
```

Sherpa's current React Native ASR API accepts `number[]` for online
`acceptWaveform()`, so the Sherpa benchmark path still incurs a JS array copy
per chunk. It is useful for apples-to-apples end-to-end progress/memory timing,
but a future typed-array/JSI path is needed before treating it as a zero-copy
streaming integration.

## Long-audio benchmark snapshot

For the current high-level Moonshine vs Sherpa ONNX/Qwen3 long-audio results, see [`LONG_AUDIO_BENCHMARK.md`](./LONG_AUDIO_BENCHMARK.md).

## Upstream ASR patching

For maintaining local upstream checkouts and preparing Moonshine/Sherpa ONNX PRs
from the long-audio validation work, see [`UPSTREAM_ASR_PATCHING.md`](./UPSTREAM_ASR_PATCHING.md).

## Platform notes

### iOS

`AVAssetReader` + `AVAssetReaderTrackOutput` configured for Float32 LinearPCM
at the requested rate/channels. AVFoundation handles resampling and downmix.
The decoder runs on a private serial queue keyed on `requestId`.

`extractRawAudioData` was patched in the same change to sanitize samples
(NaN/Inf → 0, clamp inside Int16/Int32 range) before integer conversion,
removing the previous Swift trap that could crash the host app on malformed
input.

### Android

`MediaExtractor` + `MediaCodec` produces 16-bit PCM. The decoder converts to
Float32, downmixes to the requested channel count (channel average for
multi-channel → mono), and resamples via per-stream linear interpolation that
preserves continuity across decoder buffers.

`content://` URIs are copied to the app cache directory before extraction so
MediaExtractor can read by path.

### Web

`AudioContext.decodeAudioData` decodes the whole file in memory and chunks the
decoded buffer afterwards. This is documented in `getAudioDecodeCapabilities()`
under `knownLimitations`.

## Compatibility

`extractAudioData` still works; it now uses sanitized integer conversion on
iOS. `streamAudioData` is additive and lives behind a feature check — call
`getAudioDecodeCapabilities()` to confirm before showing UI that depends on it.
