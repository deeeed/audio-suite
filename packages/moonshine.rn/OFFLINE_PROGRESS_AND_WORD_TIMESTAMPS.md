# Offline Progress + Word Timestamp Validation

Validated on 2026-04-08 from the `moonshine.rn` package using the
package-owned harness:

```bash
yarn workspace @siteed/moonshine.rn validate:offline:contract <model-id> [device-filter]
```

The harness drives a real offline file transcription through the playground app
runtime, listens for `MoonshineTranscriptEvent`s, and reports:

When a web consumer needs to wire explicit model URLs or a separate progress
model base path, pass typed fields on the load config instead:

```ts
await Moonshine.createTranscriberFromFiles({
  modelArch: 'tiny',
  modelPath: '/ignored-on-web-when-urls-are-explicit',
  options: { wordTimestamps: true },
  webEncoderUrl: 'https://example.com/encoder_model.ort',
  webDecoderUrl: 'https://example.com/decoder_with_attention.ort',
  webProgressModelBasePath: 'https://download.moonshine.ai/model/tiny-en/quantized',
})
```

- whether any intermediate progress-like events were emitted
- whether the event sequence is `none`, `terminal-only`, or `granular`
- whether `line.words` is returned when `wordTimestamps` is enabled
- which validation model actually ran (important for web tiny fallback)

For longer offline progress checks, the harness also accepts the bundled
`jfk.wav` sample:

```bash
yarn workspace @siteed/moonshine.rn validate:offline:contract <model-id> <device-filter> jfk
```

## Current findings

### iOS simulator (`sim:playground-1`)

- model requested: `moonshine-small-streaming-en`
- sample: bundled speech WAV
- transcript: `Hello world`
- progress events: `3`
  - `lineStarted`
  - `lineTextChanged`
  - `lineCompleted`
- progress semantics: **terminal-burst**
- word timestamps: **returned**
- line count with words: `1`
- word count: `2`

### Android physical device

- model requested: `moonshine-small-streaming-en`
- sample: bundled speech WAV
- transcript: `Hello world`
- progress events: `3`
  - `lineStarted`
  - `lineTextChanged`
  - `lineCompleted`
- progress semantics: **terminal-burst**
- word timestamps: **returned**
- line count with words: `1`
- word count: `2`

### Web (`web (Chrome)`)

- model requested: `moonshine-medium-streaming-en`
- actual validation model: `moonshine-tiny-web-word-timestamp-validation`
- sample: bundled speech WAV
- transcript: `A low ward.`
- progress events: `3`
  - `lineStarted`
  - `lineTextChanged`
  - `lineCompleted`
- progress semantics: **terminal-burst**
- word timestamps: **returned**
- line count with words: `1`
- word count: `3`

## Interpretation

### Offline progress fidelity

`transcribeWithoutStreaming(...)` now emits the same upstream-style transcript
events through the wrapper by routing offline file transcription through the
existing chunked temporary-stream path.

On the short bundled speech sample:

- iOS: terminal burst
- Android: terminal burst
- Web: terminal burst

On the longer bundled `jfk.wav` sample:

- iOS: **granular** (`44` events over `1234ms`)
- Android: **granular** (`44` events over `3514ms`)
- Web: **granular** (`69` events over `9810ms`)

This means offline progress is now meaningful on long-form runs across native
and web, even though the short sample can still look bursty because it finishes
too quickly to expose many intermediate updates.

If granular progress is desired, it should be implemented inside
`moonshine.rn`, not faked in consumer UIs.

`transcribeWithoutStreaming()` accepts `MoonshineTranscribeOptions`, so callers
can tune `chunkDurationMs` instead of relying on a hidden wrapper constant when
trading off progress granularity against throughput.

### Offline word timestamps

When `wordTimestamps` is enabled:

- iOS: `line.words` is returned in practice
- Android: `line.words` is returned in practice
- Web: `line.words` is returned when an attention-capable decoder is available
  (for long-form web validation, the wrapper now uses a non-word-timestamp
  progress model for intermediate updates and a final attention-enabled pass to
  return the word timings)

## Artifact caveats

- Native streaming word timestamps require the attention-capable Moonshine
  decoder assets to be present alongside the model bundle.
- Web validation currently falls back to the tiny attention decoder for word
  timestamp validation, because that is the web path with confirmed support.

The playground benchmark downloader now validates cached Moonshine assets
before reuse so stale `decoder_kv.ort` bundles do not silently break Android
again.
