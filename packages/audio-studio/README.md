# @siteed/audio-studio

[![Version](https://img.shields.io/npm/v/@siteed/audio-studio.svg)](https://www.npmjs.com/package/@siteed/audio-studio)
[![Downloads](https://img.shields.io/npm/dt/@siteed/audio-studio.svg)](https://www.npmjs.com/package/@siteed/audio-studio)
[![License](https://img.shields.io/npm/l/@siteed/audio-studio.svg)](https://www.npmjs.com/package/@siteed/audio-studio)
[![GitHub stars](https://img.shields.io/github/stars/deeeed/audiolab.svg?style=social&label=Star)](https://github.com/deeeed/audiolab)

**Give it a GitHub star, if you found this repo useful.**

Cross-platform audio recording, analysis, and processing for React Native and Expo. Mel spectrogram and spectral feature extraction run through a shared C++ layer on iOS, Android, and web (via WASM).

> Formerly `@siteed/expo-audio-studio`. See [MIGRATION.md](../../MIGRATION.md) for upgrade steps.

<div align="center">
  <div style="display: flex; justify-content: center; gap: 20px; margin: 30px 0;">
    <div>
      <h3>iOS</h3>
      <img src="../../docs/ios.gif" alt="iOS Demo" width="280" />
    </div>
    <div>
      <h3>Android</h3>
      <img src="../../docs/android.gif" alt="Android Demo" width="280" />
    </div>
  </div>

  <p>
    <a href="https://apps.apple.com/app/audio-playground/id6739774966">
      <img src="https://developer.apple.com/app-store/marketing/guidelines/images/badge-download-on-the-app-store.svg" alt="App Store" height="40" />
    </a>
    <a href="https://play.google.com/store/apps/details?id=net.siteed.audioplayground">
      <img src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png" alt="Google Play" height="40" />
    </a>
  </p>
  <p><a href="https://deeeed.github.io/audiolab/playground">Try the web demo</a></p>
</div>

## Features

- **Recording** — real-time streaming, dual-stream (raw PCM + compressed), max active duration limits, background recording, zero-latency start via `prepareRecording`
- **Device management** — list/select input devices (Bluetooth, USB, wired), automatic fallback
- **Interruption handling** — auto pause/resume during phone calls
- **Audio analysis** — MFCC, spectral features, mel spectrogram, tempo, pitch, waveform preview
- **Native performance** — mel spectrogram and FFT-based features (MFCC, spectral centroid, etc.) computed in shared C++ on all platforms (JNI on Android, Obj-C++ bridge on iOS, WASM on web)
- **Trimming** — precision cut with multi-segment support (keep or remove ranges)
- **Notifications** — Android live waveform in notification, iOS media player integration
- **Consistent format** — WAV PCM output across all platforms

## Install

```bash
yarn add @siteed/audio-studio
```

## Quick Start

```typescript
import { useAudioRecorder } from '@siteed/audio-studio'

const { startRecording, stopRecording, isRecording } = useAudioRecorder()

// Record
await startRecording({
    sampleRate: 44100,
    channels: 1,
    encoding: 'pcm_16bit',
})

// ... later
const result = await stopRecording()
console.log('Saved to:', result.fileUri)
```

### Zero-Latency Recording

Pre-initialize to eliminate startup delay:

```typescript
const { prepareRecording, startRecording, stopRecording } =
    useSharedAudioRecorder()

await prepareRecording({
    sampleRate: 44100,
    channels: 1,
    encoding: 'pcm_16bit',
})

// Later — starts instantly
await startRecording()
```

### Shared State Across Components

```typescript
const AudioApp = () => (
  <AudioRecorderProvider>
    <RecordButton />
    <AudioVisualizer />
  </AudioRecorderProvider>
);
```

### Float32 Streaming (for ML / DSP)

Set `streamFormat: 'float32'` to get `Float32Array` on all platforms instead of base64:

```typescript
await startRecording({
    sampleRate: 16000,
    channels: 1,
    encoding: 'pcm_32bit',
    streamFormat: 'float32',
    onAudioStream: async (event) => {
        const samples = event.data as Float32Array
        await myModel.feed(samples)
    },
})
```

### Max Active Recording Duration

Use `maxDurationMs` to cap cumulative active recording time. Paused time does
not count toward the limit. By default, the recorder emits
`onMaxDurationReached` and continues recording so your app can decide what to
do next. Set `autoStopOnMaxDuration: true` to stop automatically.

```typescript
const {
    startRecording,
    maxDurationMs,
    maxDurationReached,
} = useAudioRecorder()

await startRecording({
    sampleRate: 16000,
    channels: 1,
    maxDurationMs: 60_000,
    autoStopOnMaxDuration: true,
    onMaxDurationReached: (event) => {
        console.log('Reached recording limit:', event.maxDurationMs)
    },
})
```

When auto-stop is enabled, the max-duration event is emitted before the stop
finishes. Use the event and stream callbacks for immediate UI updates, then use
normal recording state to observe that the recorder has stopped.

## Audio Analysis

For live analysis during recording, `useAudioRecorder` keeps a recent analysis
window in `analysisData` for visualization and, by default, also retains the
full analysis history so `stopRecording().analysisData` can describe the whole
recording. This option only matters when `enableProcessing: true`. For
long-running sessions that only need live callbacks, disable the full-history
retention to avoid unbounded JS memory growth:

```typescript
await startRecording({
    sampleRate: 16000,
    channels: 1,
    enableProcessing: true,
    keepFullAnalysis: false,
    onAudioAnalysis: async (analysis) => {
        // Consume each analysis chunk without retaining the full recording history.
        updateVoiceActivity(analysis.dataPoints)
    },
})
```

```typescript
import {
    extractAudioAnalysis,
    extractPreview,
    extractMelSpectrogram,
    trimAudio,
} from '@siteed/audio-studio'

// Feature extraction
const analysis = await extractAudioAnalysis({
    fileUri: 'path/to/recording.wav',
    features: { rms: true, zcr: true, mfcc: true, spectralCentroid: true },
})

// Lightweight waveform for visualization
const preview = await extractPreview({
    fileUri: 'path/to/recording.wav',
    pointsPerSecond: 50,
})

// Mel spectrogram for ML
const mel = await extractMelSpectrogram({
    fileUri: 'path/to/recording.wav',
    nMels: 40,
    hopLengthMs: 10,
})

// Trim audio
const trimmed = await trimAudio({
    fileUri: 'path/to/recording.wav',
    ranges: [{ startTimeMs: 1000, endTimeMs: 5000 }],
    mode: 'keep',
})
```

### Which Method to Use

| Method                  | Cost         | Use case                              |
| ----------------------- | ------------ | ------------------------------------- |
| `extractPreview`        | Light        | Waveform visualization                |
| `extractRawWavAnalysis` | Light        | WAV metadata without decoding         |
| `extractAudioData`      | Medium       | Raw PCM for custom processing         |
| `extractAudioAnalysis`  | Medium-Heavy | MFCC, spectral features, pitch, tempo |
| `extractMelSpectrogram` | Heavy        | Frequency-domain for ML               |

## Docs

- [Getting Started Guide](https://deeeed.github.io/audiolab/docs/)
- [Contributing](./CONTRIBUTE.md)
- [AudioPlayground](https://deeeed.github.io/audiolab/playground) — live demo of all features
- [@siteed/audio-ui](https://github.com/deeeed/audiolab/tree/main/packages/audio-ui) — waveform, spectrogram, and audio control components

## License

MIT — see [LICENSE](LICENSE).

---

<sub>Created by [Arthur Breton](https://siteed.net)</sub>

### Compact waveform preview bars

For UI waveform previews, prefer `extractPreviewBars` over adapting a full
`AudioAnalysis` when detailed features are not needed:

```typescript
import { extractPreviewBars } from '@siteed/audio-studio'

const preview = await extractPreviewBars({
    fileUri,
    numberOfBars: 120,
    startTimeMs: 0,
    endTimeMs: 30_000,
})

console.log(preview.bars, preview.durationMs, preview.amplitudeRange)
```

`extractPreviewBars` returns compact `PreviewBar[]` data plus duration, sample
rate, channel count, bit depth, amplitude/RMS ranges, and extraction timing. The
existing `extractPreview` API remains available for compatibility with callers
that expect `AudioAnalysis` / `DataPoint[]`.

Native Android and iOS expose an `extractPreviewBars` bridge for compact
bars-out results. JS also keeps a compatibility fallback through `extractPreview`
for older native runtimes that do not yet provide the compact bridge.

#### C++ scope note

Waveform preview bar extraction intentionally keeps file decode in platform
code. A future C++ `WaveformBarsProcessor` should be considered only as a pure
PCM-in/bars-out processor if Kotlin/Swift/Web implementations become a real
maintenance problem or if waveform bars are bundled into a broader shared
processor/VAD effort. This is not a formal benchmark claim.
