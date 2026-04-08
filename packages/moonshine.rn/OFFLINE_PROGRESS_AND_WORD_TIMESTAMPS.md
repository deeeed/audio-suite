# Offline Progress + Word Timestamp Validation

Validated on 2026-04-08 from the `moonshine.rn` package using the
package-owned harness:

```bash
yarn workspace @siteed/moonshine.rn validate:offline:contract <model-id> [device-filter]
```

The harness drives a real offline file transcription through the playground app
runtime, listens for `MoonshineTranscriptEvent`s, and reports:

- whether any intermediate progress-like events were emitted
- whether the event sequence is `none`, `terminal-only`, or `granular`
- whether `line.words` is returned when `wordTimestamps` is enabled
- which validation model actually ran (important for web tiny fallback)

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
events through the wrapper, but they currently arrive as a **terminal burst**,
not as meaningful incremental progress.

- iOS: `lineStarted -> lineTextChanged -> lineCompleted` are emitted together at
  the end of the offline call
- Android: `lineStarted -> lineTextChanged -> lineCompleted` are emitted
  together at the end of the offline call
- Web: `lineStarted -> lineTextChanged -> lineCompleted` are emitted together
  at the end of the offline call

So the current offline progress contract is still **not meaningfully granular
across platforms**. Consumer apps should treat offline transcription as:

- a single offline operation that may emit a final line-event burst immediately
  before the promise resolves

If granular progress is desired, it should be implemented inside
`moonshine.rn`, not faked in consumer UIs.

### Offline word timestamps

When `wordTimestamps` is enabled:

- iOS: `line.words` is returned in practice
- Android: `line.words` is returned in practice
- Web: `line.words` is returned when an attention-capable decoder is available

## Artifact caveats

- Native streaming word timestamps require the attention-capable Moonshine
  decoder assets to be present alongside the model bundle.
- Web validation currently falls back to the tiny attention decoder for word
  timestamp validation, because that is the web path with confirmed support.

The playground benchmark downloader now validates cached Moonshine assets
before reuse so stale `decoder_kv.ort` bundles do not silently break Android
again.
