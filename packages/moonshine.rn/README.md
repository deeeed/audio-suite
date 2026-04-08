# `@siteed/moonshine.rn`

React Native bindings for Moonshine on-device speech recognition, offline file
transcription, streaming transcription, and intent recognition across iOS,
Android, and web.

## Highlights

- Offline transcription and file-driven live streaming
- Incremental transcript events during streaming and offline processing
- Word timestamps when the required model assets are present
- Intent recognizer support
- Web backend built on `onnxruntime-web`
- Typed API for explicit transcriber instances and singleton-style usage

## Install

```bash
yarn add @siteed/moonshine.rn
```

For Expo / React Native apps using Yarn Berry, `node-modules` is still the most
predictable setup:

```yaml
nodeLinker: node-modules
```

## Platform requirements

- **Android:** `minSdkVersion 35`
- **iOS:** native rebuild required after installing or upgrading the package
- **Web:** `window.ort` must be available before creating a transcriber

## Quick start

### Create a transcriber from files

```ts
import Moonshine from '@siteed/moonshine.rn';

const transcriber = await Moonshine.createTranscriberFromFiles({
  modelArch: 'small-streaming',
  modelPath: '/absolute/path/to/model-dir',
  options: {
    wordTimestamps: true,
  },
});

const result = await transcriber.transcribeWithoutStreaming(
  sampleRate,
  samples
);
console.log(result.text);
```

### Listen for incremental transcript events

```ts
const removeListener = transcriber.addListener((event) => {
  switch (event.type) {
    case 'lineStarted':
    case 'lineUpdated':
    case 'lineTextChanged':
    case 'lineCompleted':
      console.log(event.line);
      break;
    case 'error':
      console.error(event.error);
      break;
  }
});
```

## Main API surface

### Transcriber lifecycle

- `createTranscriberFromFiles()`
- `createTranscriberFromAssets()`
- `createTranscriberFromMemory()`
- `releaseTranscriber()`

### Singleton compatibility helpers

- `loadFromFiles()`
- `loadFromAssets()`
- `loadFromMemory()`
- `initialize()`
- `release()`

### Transcription

- `start()` / `stop()`
- `createStream()` / `removeStream()`
- `startStream()` / `stopStream()`
- `addAudio()` / `addAudioToStream()`
- `transcribeFromSamples()`
- `transcribeWithoutStreaming()`

### Intent recognition

- `createIntentRecognizer()`
- `releaseIntentRecognizer()`
- `registerIntent()` / `unregisterIntent()`
- `processUtterance()`
- `clearIntents()`
- `setIntentThreshold()` / `getIntentThreshold()`
- `getIntentCount()`

## Model options

Typed transcriber options include:

- `identifySpeakers`
- `speakerIdClusterThreshold`
- `vadThreshold`
- `vadHopSize`
- `vadWindowDurationMs`
- `vadMaxSegmentDurationMs`
- `vadLookBehindSampleCount`
- `maxTokensPerSecond`
- `logApiCalls`
- `logOrtRuns`
- `logOutputText`
- `saveInputWavPath`
- `wordTimestamps`

`transcriberOptions` is also available as a low-level escape hatch for
upstream native options that are not yet modeled in the typed surface.

## Platform notes

### Android

By default, the published package uses the Maven Moonshine Android artifact.
That is the intended path for external consumers.

The package also supports repo-local source builds for internal development, but
that is an advanced workflow and not the default installation path.

### iOS

The podspec consumes the packaged Moonshine xcframework. After upgrading the
package, rebuild the native iOS app so the JS layer and native bridge stay in
sync.

### Web

The web backend is package-owned and does not depend on the published
`@moonshine-ai/moonshine-js` runtime bundle.

Web-specific typed load-config overrides are available when needed:

- `webEncoderUrl`
- `webDecoderUrl`
- `webProgressModelBasePath`

Use `configureMoonshineWeb()` to override the default model CDN or the
`onnxruntime-web` wasm base path.

## Word timestamps

Word timestamps depend on model assets, not just API flags.

- Native streaming/offline word timestamps require the attention-capable decoder
  assets to be present alongside the model bundle.
- On web, word timestamps require an attention-capable decoder path.

## Speaker metadata

Speaker-turn / speaker-clustering hints are available, but they should be
considered **experimental**. They are useful for tentative turn segmentation,
not trusted diarization or speaker identity.

## Advanced / repo-local workflows

These are mainly for development inside this monorepo:

```bash
bash packages/moonshine.rn/setup.sh
bash packages/moonshine.rn/build-moonshine-android.sh
bash packages/moonshine.rn/build-moonshine-ios.sh
bash packages/moonshine.rn/build-moonshine-web.sh
```

Useful package-local checks:

```bash
yarn release:beta:preflight
yarn validate:offline:contract <model-id> [device-filter]
```

## Known limitations

- `MicTranscriber` is not wrapped directly; apps are expected to own microphone
  capture and audio routing.
- Android and Sherpa must use a compatible ONNX Runtime ABI when linked into the
  same app binary.
- External Android consumers still need an app configuration compatible with
  `minSdkVersion 35`.
