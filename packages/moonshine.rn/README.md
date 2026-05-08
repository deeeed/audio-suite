# `@siteed/moonshine.rn`

[![Version](https://img.shields.io/npm/v/@siteed/moonshine.rn.svg)](https://www.npmjs.com/package/@siteed/moonshine.rn)
[![Downloads](https://img.shields.io/npm/dt/@siteed/moonshine.rn.svg)](https://www.npmjs.com/package/@siteed/moonshine.rn)
[![License](https://img.shields.io/npm/l/@siteed/moonshine.rn.svg)](https://www.npmjs.com/package/@siteed/moonshine.rn)
[![GitHub stars](https://img.shields.io/github/stars/deeeed/audiolab.svg?style=social&label=Star)](https://github.com/deeeed/audiolab)

**Give it a GitHub star, if you found this repo useful.**

React Native bindings for Moonshine on-device speech recognition, offline
transcription from decoded PCM, streaming transcription, and intent
recognition across iOS, Android, and web.

## Highlights

- Offline transcription from decoded PCM
- Streaming transcription with incremental transcript events
- Incremental transcript events during streaming and offline processing
- Word timestamps when the required model assets are present
- Intent recognizer support
- Web backend built on `onnxruntime-web`
- Typed transcriber API with explicit cancellation support

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

const result = await transcriber.transcribe({
  input: samples,
  sampleRate: 16000,
});
console.log(result.text);
```

### Cancel an in-flight offline transcription

```ts
const controller = new AbortController();

const transcriptionPromise = transcriber.transcribe({
  input: samples,
  sampleRate: 16000,
  signal: controller.signal,
});

controller.abort();

try {
  await transcriptionPromise;
} catch (error) {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'MOONSHINE_TRANSCRIPTION_CANCELLED'
  ) {
    console.log('Transcription cancelled');
  }
}
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
    case 'transcriptionCancelled':
      console.warn('Transcription cancelled');
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
- `cancel()`
- `createStream()` / `removeStream()`
- `startStream()` / `stopStream()`
- `addAudio()` / `addAudioToStream()`
- `transcribe({ input, sampleRate, signal? })`

`transcribe(...)` accepts decoded mono PCM samples (`number[]` or
`Float32Array`) and a required `sampleRate`.

This package intentionally stays at the transcription-wrapper layer. Decode
files, URIs, and other container formats upstream before calling `transcribe`.
In this monorepo, that responsibility belongs in audio-processing utilities
such as `audio-studio`, not inside `moonshine.rn`.

Offline transcription cancellation rejects the in-flight promise with
`MOONSHINE_TRANSCRIPTION_CANCELLED`, surfaces as an `AbortError`-style
rejection, and emits a terminal `transcriptionCancelled` event instead of
returning a partial success result.

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

The public npm package does not ship the Android AAR so installs stay small.
Published consumers resolve Moonshine dynamically from Maven by default:
`ai.moonshine:moonshine-voice`.

For repo-local source builds, Gradle automatically uses
`prebuilt/android/moonshine-voice-source-release.aar` when that file exists.
You can also set `SITEED_MOONSHINE_ANDROID_AAR` /
`siteedMoonshineAndroidAar` to point at a custom AAR.

To force Maven even when a local source AAR exists, set
`SITEED_MOONSHINE_ANDROID_USE_MAVEN=1` or
`siteedMoonshineAndroidUseMaven=true`.

If you explicitly use a source AAR, ensure it does not conflict with any
app-level `libonnxruntime.so` packaged for the same ABI.

### iOS

The public npm package does not ship the Moonshine xcframework. During
`pod install`, the podspec runs `scripts/ensure-ios-artifacts.sh` to prepare the
xcframework dynamically.

By default, the script downloads
`Moonshine.xcframework.zip` from the package release artifact URL for the
current npm version, using the `@siteed/moonshine.rn@<version>` GitHub release
tag. For the `0.3.3` beta line, the released archive is `91,320,003` bytes
(about `87 MiB`) and expands to about `198 MiB` for the xcframework. The
prepared `prebuilt/ios` directory is about `333 MiB` after the selected slice is
copied into `prebuilt/ios/current`, so CI and developer machines need network
access the first time each version is prepared.

The published package pins the expected SHA-256 checksum in `package.json` and
the install script verifies it by default. To use an internal mirror or a
locally staged artifact URL, set `SITEED_MOONSHINE_IOS_XCFRAMEWORK_URL`. Mirrors
used for publishing must respond to `HEAD` or to a ranged `GET` request
(`Range: bytes=0-0`) so `validate:ios-release-artifact` can confirm the asset
before npm publish. To override the expected checksum, set
`SITEED_MOONSHINE_IOS_XCFRAMEWORK_SHA256`; this intentionally replaces the
package-pinned checksum and should only be used for trusted mirrors or local
development artifacts.

Downloaded archives are cached outside `node_modules` so reinstalling packages
does not force another network fetch. On macOS the default cache is
`~/Library/Caches/@siteed/moonshine.rn/ios/<version>-<sha>/`; override it with
`SITEED_MOONSHINE_IOS_CACHE_DIR`. Offline or sandboxed CI must either seed that
cache or point `SITEED_MOONSHINE_IOS_XCFRAMEWORK_URL` at an accessible mirror.
On non-macOS machines the fallback cache root is `$XDG_CACHE_HOME` or
`$HOME/.cache`; if neither is available, set `SITEED_MOONSHINE_IOS_CACHE_DIR`.

Normal CocoaPods output may only show `Installing Moonshine <version>` while
`prepare_command` runs; use verbose CocoaPods output or run
`bash node_modules/@siteed/moonshine.rn/scripts/ensure-ios-artifacts.sh`
directly if you need to see curl progress.

Before publishing a new npm version, upload the matching GitHub release asset
first. `npm publish` is gated by `validate:ios-release-artifact` so a missing
asset fails fast instead of shipping a package whose first `pod install` would
404. This publish-time check intentionally requires network access.

After upgrading the package, rebuild the native iOS app so the JS layer and
native bridge stay in sync.

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
