# @siteed/expo-audio-ui

[![Version](https://img.shields.io/npm/v/@siteed/expo-audio-ui.svg)](https://www.npmjs.com/package/@siteed/expo-audio-ui)
[![License](https://img.shields.io/npm/l/@siteed/expo-audio-ui.svg)](https://www.npmjs.com/package/@siteed/expo-audio-ui)
[![GitHub stars](https://img.shields.io/github/stars/deeeed/audiolab.svg?style=social&label=Star)](https://github.com/deeeed/audiolab)

**Give it a GitHub star, if you found this repo useful.**

Audio visualization and control components for React Native, built with Skia and Reanimated. Designed to work with [@siteed/audio-studio](https://github.com/deeeed/audiolab/tree/main/packages/audio-studio).

<div align="center">
  <a href="https://deeeed.github.io/audiolab/playground/">
    <img src="../../docs/demo.gif" alt="Demo" />
  </a>
  <p><a href="https://deeeed.github.io/audiolab/expo-audio-ui-storybook">Storybook</a></p>
</div>

## Components

- **AudioVisualizer** — interactive waveform with navigation, amplitude scaling, and theming
- **DecibelGauge** — gauge display for audio levels in dB
- **DecibelMeter** — linear meter with customizable thresholds
- **RecordButton** — recording button with visual feedback and animations
- **Waveform** — lightweight waveform renderer
- **AudioTimeRangeSelector** — interactive time range selection with drag handles
- **MelSpectrogramVisualizer** — real-time mel spectrogram display

## Install

```bash
yarn add @siteed/expo-audio-ui
```

Peer dependencies:

```bash
yarn add @shopify/react-native-skia react-native-gesture-handler react-native-reanimated
```

## Development

```bash
cd packages/audio-ui
yarn storybook
# Opens at http://localhost:6068
```

## Docs

- [Getting Started Guide](https://deeeed.github.io/audiolab/docs/)
- [Storybook](https://deeeed.github.io/audiolab/expo-audio-ui-storybook)

## License

MIT — see [LICENSE](LICENSE).

---

<sub>Created by [Arthur Breton](https://siteed.net)</sub>

## Waveform/player/recorder contracts

`@siteed/audio-ui` is a controlled rendering package. It does not read files,
play audio, request permissions, start recorders, or call native extraction
modules from its main entrypoint. Apps pass waveform bars and state in through
props.

### Existing-file preview

Use an app/domain extraction layer such as `@siteed/audio-studio` to create
compact bars, then render them with `WaveformPreview` or `AudioPlayerWidget`:

```tsx
import { AudioPlayerWidget } from '@siteed/audio-ui'
import { extractPreviewBars } from '@siteed/audio-studio'

const preview = await extractPreviewBars({ fileUri, numberOfBars: 96 })

<AudioPlayerWidget
  dataPoints={preview.bars}
  width={280}
  density="chat"
  currentTimeMs={currentTimeMs}
  durationMs={preview.durationMs}
  isPlaying={isPlaying}
  onPlayPause={togglePlayback}
  onSeek={seekTo}
/>
```

### Controlled chat recorder

`ChatRecordWidget` displays the recorder state and live waveform bars supplied by
the app. The app still owns `useAudioRecorder`, permissions, final URI, duration,
and send/cancel behavior.

```tsx
<ChatRecordWidget
    state={isRecording ? 'recording' : 'idle'}
    dataPoints={liveBars}
    elapsedMs={elapsedMs}
    width={320}
    onRecordPress={startRecording}
    onStopPress={stopRecording}
    sendSlot={<SendButton />}
    cancelSlot={<CancelButton />}
/>
```

### Migrating from `DataPoint[]`

The UI components accept structural waveform points: `amplitude`, optional `rms`,
optional `silent`, and optional time fields. Existing `AudioAnalysis` and
`DataPoint[]` objects can be passed directly when they have those fields, or
normalized with `waveformAnalysisFromAudioStudioAnalysis` /
`waveformBarsFromAudioStudioDataPoints`.
