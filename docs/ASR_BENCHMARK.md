# ASR Benchmark

## Purpose

This document tracks AudioLab ASR benchmark surfaces. The current live-production recommendation is summarized in [LIVE_ASR_RECOMMENDATION.md](./LIVE_ASR_RECOMMENDATION.md). The rejected Zipformer compatibility investigation is preserved separately in [ASR_ZIPFORMER_INVESTIGATION.md](./ASR_ZIPFORMER_INVESTIGATION.md) so the practical matrix can focus on Moonshine, Qwen3, and Whisper rows.

This document tracks two related mobile ASR benchmark surfaces:

- Audio Playground `/asr-benchmark`: the current recommendation workflow for live Moonshine transcription, Sherpa live speaker turns, segmented Sherpa offline ASR, and EchoBridge parity checks.
- `apps/sherpa-voice`: the legacy Recorder-like Sherpa ASR matrix, kept as historical model-selection evidence.

The practical matrix intentionally keeps useful Moonshine/Qwen3/Whisper tradeoff rows, but no longer spends default time on streaming rows already proven too low-value for this product decision.

## Sherpa Voice Legacy Matrix

This section is historical `apps/sherpa-voice` model-selection context, not active Audio Playground product guidance. The current practical/default workflow excludes the Zipformer rows below.

- `streaming-zipformer-en-20m-mobile`
  Historical purpose: compact live mobile baseline
- `streaming-zipformer-en-general`
  Historical purpose: previously tested Sherpa-only live baseline
- `streaming-zipformer-ctc-small-2024-03-18`
  Historical purpose: streaming CTC comparison so the live matrix was not transducer-only
- `streaming-zipformer-bilingual-zh-en-2023-02-20`
  Historical purpose: bilingual live fallback that turned out to be the best validated Sherpa-only live model on English meeting audio
- `streaming-paraformer-bilingual-zh-en`
  Historical purpose: non-Zipformer streaming candidate from Sherpa's online model zoo
- `streaming-zipformer-en-kroko-2025-08-06`
  Historical purpose: newer upstream live candidate
- `whisper-tiny-en`
  Historical purpose: small offline English baseline
- `whisper-small-multilingual`
  Historical purpose: heavier offline multilingual quality reference
- `sense-voice-zh-en-ja-ko-yue-int8-2025-09-09`
  Historical purpose: multilingual offline ASR reference
- `nemo-canary-180m-flash-en-es-de-fr`
  Historical purpose: offline translation-capable reference

## Benchmark Modes

- `Sample File`
  Runs the same local sample audio through the selected model. `Run Practical File Matrix` runs the current Moonshine/Qwen3/Whisper recommendation set on that file-quality path.
- `Simulated Live`
  Feeds the same PCM waveform into live-capable runtimes in deterministic chunks and records init time, first partial latency, first commit latency, update counts, wall/processing RTF, max backlog, and final transcript. Live microphone replay is intentionally not part of this page because speaker-to-room-to-mic acoustics make engine comparisons noisy.

## Results

The page keeps results in memory for the current session and exports them as JSON through the clipboard.

Each result records:

- model id and name
- runtime type (`streaming` or `offline`)
- benchmark mode
- init time
- recognize time or live latency metrics
- transcript
- error, if any

Audio Playground direct-runner artifacts are written under `apps/playground/.agent/reports/`. Historical `apps/sherpa-voice` recipes used their own `.agent/reports/` directory.

## Current Findings

Measured on a physical Pixel 6a using `IS1001a.Mix-Headset.wav` from the AMI corpus, clipped to `150s-170s`.

Reference transcript:

- `So the the goal is to have a remote control, so to have an advantage over our competitors, we have to be original, we have to be trendy and we have to also try to be user-friendly. So uh the design step will be divided in three`

Live recommendation:

- Historical best Sherpa-only live row: `streaming-zipformer-bilingual-zh-en-2023-02-20`
- Historical live metrics: `WER 20.8%`, `CER 13.1%`, `init 2289 ms`, `first partial 4994 ms`, `first commit 18151 ms`
- Current conclusion: keep this only as historical evidence; the active recommendation workflow excludes Zipformer and focuses on Moonshine live draft plus Sherpa speaker turns and Qwen3/Whisper delayed/final passes

Offline reference ranking:

- `whisper-tiny-en`: `WER 4.2%`, `recognize 3919 ms`
- `whisper-small-multilingual`: same normalized `WER 4.2%`, but much slower at `17725 ms`
- `sense-voice-zh-en-ja-ko-yue-int8-2025-09-09`: `WER 10.4%`
- `streaming-paraformer-bilingual-zh-en` sample decode: `WER 14.6%`

Rejected or blocked candidates:

- `streaming-zipformer-en-20m-mobile`: far too inaccurate for the target
- `streaming-zipformer-en-kroko-2025-08-06`: unstable on the RN Android path
- `zipformer-en-general`: packaging/path resolution bug previously blocked init
- `nemo-canary-180m-flash-en-es-de-fr`: still unsupported end to end on Android in the current RN path

## sherpa-onnx.rn Changes In This Branch

- Added ASR config fields for `language`, `task`, `useItn`, `srcLang`, `tgtLang`, and `usePnc`.
- Added `canary` to the RN ASR model type union.
- Removed web and Android hardcoded Whisper and SenseVoice defaults so benchmark settings can reach the runtime.
- Enabled Canary config planning on web and Canary config wiring on Android.
- Fixed `resolveModelDir()` so model directories with both an extracted `sherpa-onnx-*` subdirectory and the original archive resolve to the actual ONNX files.

## Remaining Package Follow-Ups

- iOS bridge/codegen still needs the new ASR fields forwarded explicitly if iOS should match Android/web behavior for Whisper translation, SenseVoice options, and Canary config.
- The vendored Sherpa runtime is still behind upstream `v1.12.34`. Updating it should be treated as a separate validated package refresh, not assumed from the benchmark UI work.
- If benchmarking becomes a permanent workflow, some timing and transcript instrumentation may belong in `sherpa-onnx.rn` instead of staying app-local.
- Model extraction/status handling can still leave freshly downloaded archives stuck in `extracting` until a manual refresh. That should be fixed in model management rather than worked around in benchmark scripts.

## Translation Note

This branch still focuses on Recorder-like live transcription first.

Translation remains a reference track because:

- the current practical live path in Sherpa for RN is streaming ASR, not true streaming translation
- the included local sample assets are English-only
- Canary is useful for offline translation feasibility, not as a drop-in replacement for Google Recorder style live UX

## Audio Playground EchoBridge Replay Snapshot

Audio Playground now includes the `moonshine-sherpa-echobridge-perps-5m` direct replay preset. It stages the same 5-minute EchoBridge meeting fixture into the app sandbox, scores against the EchoBridge WhisperService `medium.en` backend reference, and runs Sherpa Qwen3-ASR as 30-second offline segments to avoid retained native heap.

The Sherpa offline path uses the reusable `SegmentedOfflineAsrSession` JS helper from `@siteed/sherpa-onnx.rn`. It does not require a new native API: bounded PCM windows are submitted through `ASR.recognizeFromSamples`, segment/progress events are emitted, and Android can release/reinitialize the Sherpa ASR runtime between windows. The direct WAV benchmark still loads the 5-minute WAV into JS memory first for scoring parity; use `/long-audio-validation` for the progressive decoder path that proves compressed long audio can be decoded and transcribed window-by-window.

## Audio Playground Mobile Recommendation Workflow

The dev-only Audio Playground `/asr-benchmark` page is the combined recommendation surface for live Moonshine transcription, Sherpa speaker-turn strategy, segmented Sherpa offline ASR, and EchoBridge Whisper parity. Moonshine speaker identification stays default-off in this benchmark because Sherpa VAD + Speaker ID owns tentative live speaker turns; offline/windowed diarization remains the final speaker-label baseline.

| Use case                                     | Recommended default                                                            | Alternate                                                 | Avoid/default-off                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| True-live low-latency transcript             | Moonshine Medium after RN transport optimization when the device can afford it | Moonshine Small as lower-memory/lower-backlog fallback    | Recommending rejected streaming rows or offline Qwen/Whisper as instant captions |
| Live speaker turns                           | Sherpa VAD + Speaker ID through `LiveSpeakerTurnSession`                       | Offline diarization for final quality                     | Treating live speaker ID as final diarization                                    |
| Delayed high-quality live / final transcript | Sherpa Qwen3-ASR 0.6B INT8 rolling or segmented offline                        | Sherpa Whisper Medium INT8 when Whisper parity is desired | Presenting rolling offline as true live                                          |
| EchoBridge parity testing                    | Sherpa Whisper Medium INT8                                                     | Sherpa Whisper Small                                      | Interpreting Whisper-vs-Whisper scores as human WER                              |
| Legacy compatibility                         | Manual `whisper.rn` small runs only                                            | none                                                      | Practical default matrix runs                                                    |
| Stress testing                               | Opt-in Sherpa Whisper Medium FP32 preset                                       | Larger-memory device profile                              | Default Pixel 6a matrix runs                                                     |

Use `Run Practical File Matrix` in the page to run the mobile-safe Moonshine/Qwen3/Whisper model set on the selected sample/file path. Use per-model `Simulated Live`, or the direct runner, for live RTF/backlog evidence. The direct runner runs both file-quality and simulated-live paths where applicable, records audio duration, chunk count, wall RTF, processing RTF, max chunk time, and max backlog, and is the reproducibility source for long-run recommendation evidence. It intentionally excludes the rejected Zipformer rows, FP32 Sherpa Whisper Medium, and `whisper.rn` small unless explicitly requested. The direct runner mirrors the practical default when no `BENCHMARK_MODELS` are provided, exposes a named practical preset, keeps `moonshine-sherpa-echobridge-perps-5m` as an alias for the same set, and accepts `BENCHMARK_MODELS=all` for the full non-rejected model sweep:

```bash
cd apps/playground
ADB_SERIAL=<adb-serial> \
BENCHMARK_DEVICE="Pixel 6a - 16 - API 36" \
BENCHMARK_PRESET=mobile-asr-recommendation-echobridge-perps-5m \
node scripts/agentic/direct-asr-benchmark.mjs
```

### Reproducibility

`direct-asr-benchmark.mjs` report JSON now records enough provenance to rerun the same matrix after upstream Moonshine, sherpa-onnx, or model updates:

- git branch, commit, and dirty-working-tree flag
- `audio-playground`, `moonshine.rn`, and `sherpa-onnx.rn` package versions
- Android device model, API level, build fingerprint, app package, route, preset, timeouts, and model cache path
- selected clip fingerprints, including host file size and SHA-256
- configured Moonshine/Sherpa model source URLs or source app/package and per-file device size/SHA-256 fingerprints

The generated Markdown includes a compact reproducibility table; the generated JSON contains the full per-file hashes. In JSON, `benchmarkConfig.models` is the explicit `BENCHMARK_MODELS` request, while `benchmarkConfig.resolvedModels` and `selectedModels` record the actual model rows used after preset/default expansion. Keep benchmark evidence as generated reports under `apps/playground/.agent/reports/` and cite the report filename in PRs/docs so recommendations can be refreshed when upstream versions change.

Run the FP32 Whisper Medium stress row only when explicitly requested:

```bash
cd apps/playground
ADB_SERIAL=<adb-serial> \
BENCHMARK_DEVICE="Pixel 6a - 16 - API 36" \
BENCHMARK_ALLOW_MODEL_DOWNLOAD=1 \
BENCHMARK_OFFLINE_TIMEOUT_MS=3600000 \
BENCHMARK_PRESET=sherpa-whisper-fp32-echobridge-perps-5m \
node scripts/agentic/direct-asr-benchmark.mjs
```

Measured on Pixel 6a (`Pixel 6a - 16 - API 36`):

| Model                                    | Mode              | WER vs EchoBridge | CER vs EchoBridge | Runtime/session | Notes                                                                                                                     |
| ---------------------------------------- | ----------------- | ----------------: | ----------------: | --------------: | ------------------------------------------------------------------------------------------------------------------------- |
| Sherpa Whisper Medium INT8               | offline segmented |             19.5% |             16.3% |         500.0 s | 10 × 30 s segments; closest successful on-device Whisper-vs-EchoBridge parity row in this run                             |
| Sherpa Whisper Small                     | offline segmented |             29.3% |             22.7% |         255.7 s | 10 × 30 s segments; useful manual/`sherpa-whisper-echobridge-perps-5m` baseline, not part of the default practical matrix |
| Sherpa Qwen3-ASR 0.6B INT8 direct replay | offline segmented |             28.1% |             22.8% |         268.4 s | 10 × 30 s segments; best validated on-device text-quality candidate; not live-streaming                                   |
| Moonshine Medium Streaming               | offline/file      |             37.4% |             27.9% |         200.4 s | live-capable; quality below Qwen3                                                                                         |
| Moonshine Small Streaming                | offline/file      |             47.3% |             36.7% |          96.4 s | faster fallback                                                                                                           |

Latest 600 ms coalesced simulated-live 5-minute Moonshine replays:

| Model                      | Mode           | WER vs EchoBridge | CER vs EchoBridge | First partial | First commit | Wall RTF | Processing RTF | Max backlog | Notes                                                                                                                       |
| -------------------------- | -------------- | ----------------: | ----------------: | ------------: | -----------: | -------: | -------------: | ----------: | --------------------------------------------------------------------------------------------------------------------------- |
| Moonshine Medium Streaming | simulated live |             37.7% |             27.7% |         4.0 s |        4.4 s |    1.00× |          0.45× |       1.0 s | Better Moonshine text quality; recommended live draft on capable Pixel-class devices, but not high-quality final transcript |
| Moonshine Small Streaming  | simulated live |             47.6% |             35.5% |         4.0 s |        4.6 s |    1.00× |          0.33× |       0.3 s | Safer lower-backlog fallback; text quality is substantially worse                                                           |

> Note: simulated-live wall RTF is clock-paced by the replay harness. Use processing RTF and max backlog as the capacity signals for whether a model actually keeps up.

Whisper parity note: the EchoBridge reference transcript is produced by a server-side Whisper `medium.en` pipeline, so Sherpa Whisper Medium is a runtime/parity stress check rather than an independent human-labelled accuracy target. In this Pixel 6a run the INT8 Sherpa Whisper Medium row completed; the FP32 Sherpa Whisper Medium row was staged but did not produce a completed direct benchmark report before the dev target was lost, so it is kept behind the opt-in `sherpa-whisper-fp32-echobridge-perps-5m` preset and is not a recommended mobile default yet.

Additional streaming-decode smoke on the same Pixel 6a used `/long-audio-validation` with `streamAudioData` + `SegmentedOfflineAsrSession` over the first 60 seconds of the staged fixture. It completed successfully with 241 decoder chunks, 2 Sherpa offline ASR segments, 60.0 s processed audio, and 44.5 s wall time. This validates the compressed/decoded-stream orchestration path separately from the direct WAV benchmark.

Quantization note: the official k2-fsa Qwen3-ASR model-zoo artifact available for this run is INT8 only. Whisper Medium provides paired FP32/INT8 ONNX files, and the INT8 row completed on Pixel 6a. A true Whisper FP32-vs-INT8 quality/runtime comparison still needs a completed FP32 mobile run or a higher-memory device profile.
