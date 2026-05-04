# Audio Player Widget — what shipped and what's left

This file is the living scoreboard for PR #381 and follow-ups. Goal: a polished
audio waveform widget on par with (and ideally faster than)
[`react-native-audio-waveform`](https://github.com/SimformSolutionsPvtLtd/react-native-audio-waveform),
running on top of `@siteed/audio-studio` + `@siteed/audio-ui`.

---

## ✅ Done in PR #381

### `@siteed/audio-ui`

- **`AudioPlayerWidget`** — controlled, headless of playback engine.
  Caller supplies `currentTimeMs` / `durationMs` / `isPlaying` / callbacks.
  No `expo-audio` import. Public surface: bar color, silent color, voice
  mask, amplitude scale, pixels-per-bar, accent color, playhead color,
  background, testID.
- **`WaveformPreview`** — pure Skia `<Rect>` per bar, `voiceMask?` prop
  overrides the per-point `silent` flag for coloring. `amplitudeScale`:
  `linear | sqrt (default) | log`.
- **`SilenceTrack`** — horizontal ribbon, merges contiguous `silent` runs
  into rectangles. Now off by default in the parent widget — RMS-threshold
  silence is fragile for speech and was a misleading indicator.
- **`useWaveformLayout`** — pure layout hook. Auto-collapses gap to zero
  when bars would otherwise overflow the canvas.
- **`decimateDataPoints` / `decimateVoiceMask`** — peak-preserving binning
  so dense extractions still render cleanly at any width. The widget picks
  bar count from canvas width via `pickBarCountForWidth(width, pixelsPerBar)`
  (default 3 px per bar — matches typical music-app thumbnails).

### `@siteed/audio-studio`

- **`extractPreview` extended** with `onPointReady(point, index, total)`
  so callers can render bars incrementally. JS-side micro-batching today;
  see "Native progressive streaming" below.
- **`decodingOptions.silenceRmsThreshold`** — caller-tunable RMS threshold
  (post-process, cross-platform consistent).
- **`AudioExtractionError`** — typed wrapper with stable codes
  (`unsupported_codec`, `decode_failed`, `permission_denied`,
  `file_not_found`, `malformed_file`, `unknown`) and a `mapExtractionError`
  classifier.

### Playground

- **`/audio-player` demo screen** with live amplitude-scale toggle
  (`linear | sqrt | log`), silence-track toggle, and three threshold
  shortcuts.
- **`useAudioPlayback`** local hook (engine-agnostic surface, currently
  backed by `expo-audio`). Auto-rewinds after `didJustFinish` so a second
  `play()` actually restarts.
- **`extractPreviewWithVAD`** — combined helper that runs `extractPreview`
  + Silero VAD via `@siteed/sherpa-onnx.rn` and returns `{ analysis,
  voiceMask, voiceSegments, voiceMs }`. Lives in playground because it
  bridges two domain packages — promote to `@siteed/audio-preview` when
  a second consumer needs it.
- **`__AGENTIC__.audioPlayer` CDP probe** — `getState`, `loadSample`,
  `loadFromUri`, `setThreshold`, `setShowSilenceTrack`, `play`, `pause`,
  `toggle`, `seekTo`, `getDataPointsSample`. Exposes points / voice mask /
  VAD phase for self-driving validation.
- **`audio-player-validation.json` recipe** — drives the screen end-to-end
  through the probe. iOS sim 23/23, web 17/17 (transport branch skipped on
  web due to autoplay policy).

---

## 🚧 Remaining for parity with Simform's `react-native-audio-waveform`

### High-impact

1. **Light-weight native waveform extractor** — Simform ships a dedicated
   native path that returns *only* bar amplitudes (skipping RMS / dB /
   silent / feature analysis). Our `extractPreview` runs the full
   `extractAudioAnalysis` pipeline, doing more work per call.
   - Add `extractWaveformBars({ fileUri, numberOfPoints }) → Float32Array`
     to `audio-studio` with iOS Swift (`AVAssetReader` + `vDSP_maxv` per
     bin) and Android Kotlin (`MediaExtractor` + `MediaCodec` chunked
     read) implementations.
   - Expected speedup on big files: 5–10×.

2. **Native progressive streaming** — today the JS layer micro-batches
   `onPointReady`. Native still resolves one-shot, so the first bar still
   waits on full decode for very long files.
   - Wire native event emit from Swift `WaveformExtractor` and Kotlin
     `AudioProcessor` per-segment so JS receives points as the file
     decodes.

3. **Web VAD model wiring** — `extractPreviewWithVAD` currently fails on
   web with `vadPhase: 'error'` because the Silero asset path isn't
   compatible with the `window.SherpaOnnx.VAD.loadModel` web path
   (expects `/wasm/vad/silero_vad.onnx` served by
   `download-web-models.sh`).
   - Branch on `Platform.OS === 'web'`: pass `{ modelDir: '/wasm/vad',
     modelFile: 'silero_vad.onnx' }`. Verify `apps/playground/public/wasm/vad/`
     ships the model.

### Polish

4. **Live recording integration** — Simform has a "live" mode that draws
   bars as audio comes in. Our `useAudioRecorder` already exposes
   amplitude callbacks; build a `LiveWaveformWidget` that consumes them
   without `dataPoints` round-trips.

5. **Theming presets** — Simform exposes more knobs for bar style
   (rounded, gradient fill, animated peak). Add a `theme` prop or styled
   variants to `WaveformPreview`.

6. **Promote `extractPreviewWithVAD` to a package** — once
   `sherpa-voice` or another app consumes it, move from
   `apps/playground/src/utils/` to a new `packages/audio-preview/`
   that depends on both domain packages.

7. **Drop `SilenceTrack` from default exports?** — keep the component for
   power users but remove from the widget composition entirely. Voice-mask
   coloring on the bars is the better default; the band ribbon was
   useful only as a debugging visualization.

### Stretch / quality-of-life

8. **Native VAD in `audio-studio`** — populate `DataPoint.speech.isActive`
   with a real voice probability instead of mirroring the amplitude
   threshold. Options:
   - Lightweight: WebRTC VAD (energy + spectral, ~2 KB binary, no model).
   - ML: integrate Silero ONNX via the existing `cpp/` layer.
   This would let `audio-studio` callers get correct voice/silence
   without crossing into `sherpa-onnx.rn`.

9. **Storybook stories** — `audio-ui` already has Storybook; add stories
   for `AudioPlayerWidget`, `WaveformPreview`, `SilenceTrack` so the
   library has visible demos.

10. **Performance benchmarks** — measure extraction + render time on a
    matrix of file durations (10 s, 1 min, 10 min, 1 h) on iOS, Android,
    web. Compare against Simform on the same inputs to size the
    "where do we win" story for docs.

---

## Notes for the next session

- The recipe is the completion gate. After any change, run
  `bash scripts/agentic/validate-recipe.sh \
   scripts/agentic/teams/playground/recipes/audio-player-validation.json \
   --device sim:playground-1` (and the equivalent for web / Android).
- Web VAD failing isn't blocking — the demo gracefully degrades
  (`vadPhase: 'error'`, `voiceMask: []`) and the bars still render via
  the `silent` flag fallback.
- Don't promote `VADViewer` or `extractPreviewWithVAD` into `audio-ui`.
  That package stays UI-only — see `CLAUDE.md` and PR #381 description.
