# ASR Benchmark

## Purpose
This document tracks two related mobile ASR benchmark surfaces:

- Audio Playground `/asr-benchmark`: the current recommendation workflow for live Moonshine transcription, Sherpa live speaker turns, segmented Sherpa offline ASR, and EchoBridge parity checks.
- `apps/sherpa-voice`: the legacy Recorder-like Sherpa ASR matrix, kept as historical model-selection evidence.

The matrices intentionally do not benchmark only the likely winner. They keep weaker but useful baselines in place so tradeoffs are visible.

## Sherpa Voice Legacy Matrix
- `streaming-zipformer-en-20m-mobile`
  Purpose: compact live mobile baseline
- `streaming-zipformer-en-general`
  Purpose: current practical live baseline
- `streaming-zipformer-ctc-small-2024-03-18`
  Purpose: streaming CTC comparison so the live matrix is not transducer-only
- `streaming-zipformer-bilingual-zh-en-2023-02-20`
  Purpose: bilingual live fallback that turned out to be the best validated live model on English meeting audio
- `streaming-paraformer-bilingual-zh-en`
  Purpose: non-Zipformer streaming candidate from Sherpa's online model zoo
- `streaming-zipformer-en-kroko-2025-08-06`
  Purpose: newer upstream live candidate
- `whisper-tiny-en`
  Purpose: small offline English baseline
- `whisper-small-multilingual`
  Purpose: heavier offline multilingual quality reference
- `sense-voice-zh-en-ja-ko-yue-int8-2025-09-09`
  Purpose: multilingual offline ASR reference
- `nemo-canary-180m-flash-en-es-de-fr`
  Purpose: offline translation-capable reference

## Benchmark Modes
- `Sample File`
  Runs the same local sample audio through the selected model or all downloaded matrix models.
- `Live Mic`
  Runs streaming-only models and records init time, first partial latency, first commit latency, update counts, and final transcript.

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

Generated benchmark artifacts are written under `apps/sherpa-voice/.agent/reports/`.

## Current Findings
Measured on a physical Pixel 6a using `IS1001a.Mix-Headset.wav` from the AMI corpus, clipped to `150s-170s`.

Reference transcript:
- `So the the goal is to have a remote control, so to have an advantage over our competitors, we have to be original, we have to be trendy and we have to also try to be user-friendly. So uh the design step will be divided in three`

Live recommendation:
- Best validated live model: `streaming-zipformer-bilingual-zh-en-2023-02-20`
- Live metrics: `WER 20.8%`, `CER 13.1%`, `init 2289 ms`, `first partial 4994 ms`, `first commit 18151 ms`
- Conclusion: best in the tested Sherpa live set, but still far from Google Recorder class latency and quality

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

The dev-only Audio Playground `/asr-benchmark` page is the combined recommendation surface for live Moonshine transcription, live Sherpa speaker turns, segmented Sherpa offline ASR, and EchoBridge Whisper parity.

| Use case | Recommended default | Alternate | Avoid/default-off |
| --- | --- | --- | --- |
| Live low-latency transcript | Moonshine Small Streaming | Moonshine Medium Streaming on faster devices | Sherpa offline models for live UX |
| Live speaker turns | Sherpa VAD + Speaker ID through `LiveSpeakerTurnSession` | Offline diarization for final quality | Treating live speaker ID as final diarization |
| Post-recording transcript quality | Sherpa Qwen3-ASR 0.6B INT8 segmented offline | Sherpa Whisper Medium INT8 when Whisper parity is desired | Running offline models without segmentation/progress |
| EchoBridge parity testing | Sherpa Whisper Medium INT8 | Sherpa Whisper Small | Interpreting Whisper-vs-Whisper scores as human WER |
| Legacy compatibility | Manual `whisper.rn` small runs only | none | Practical default matrix runs |
| Stress testing | Opt-in Sherpa Whisper Medium FP32 preset | Larger-memory device profile | Default Pixel 6a matrix runs |

Use `Run Practical Matrix` in the page to run the mobile-safe model set. It intentionally excludes FP32 Sherpa Whisper Medium. The direct runner mirrors that behavior when no `BENCHMARK_MODELS` are provided, exposes a named practical preset, keeps `moonshine-sherpa-echobridge-perps-5m` as an alias for the same set, and accepts `BENCHMARK_MODELS=all` for the full legacy sweep:

```bash
cd apps/playground
ADB_SERIAL=29071JEGR20638 \
BENCHMARK_DEVICE="Pixel 6a - 16 - API 36" \
BENCHMARK_PRESET=mobile-asr-recommendation-echobridge-perps-5m \
node scripts/agentic/direct-asr-benchmark.mjs
```

Run the FP32 Whisper Medium stress row only when explicitly requested:

```bash
cd apps/playground
ADB_SERIAL=29071JEGR20638 \
BENCHMARK_DEVICE="Pixel 6a - 16 - API 36" \
BENCHMARK_ALLOW_MODEL_DOWNLOAD=1 \
BENCHMARK_OFFLINE_TIMEOUT_MS=3600000 \
BENCHMARK_PRESET=sherpa-whisper-fp32-echobridge-perps-5m \
node scripts/agentic/direct-asr-benchmark.mjs
```

Measured on Pixel 6a (`Pixel 6a - 16 - API 36`):

| Model | Mode | WER vs EchoBridge | CER vs EchoBridge | Runtime/session | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| Sherpa Whisper Medium INT8 | offline segmented | 19.5% | 16.3% | 502.4 s | 10 × 30 s segments; closest successful on-device Whisper-vs-EchoBridge parity row in this run |
| Sherpa Whisper Small | offline segmented | 29.3% | 22.7% | 255.7 s | 10 × 30 s segments; useful Whisper baseline, slower than Qwen3 and slightly lower quality here |
| Sherpa Qwen3-ASR 0.6B INT8 direct replay | offline segmented | 28.1% | 22.8% | 267.9 s | 10 × 30 s segments; best validated on-device text-quality candidate; not live-streaming |
| Moonshine Medium Streaming | offline/file | 37.4% | 27.9% | 212.4 s | live-capable; quality below Qwen3 |
| Moonshine Small Streaming | offline/file | 47.3% | 36.7% | 112.0 s | faster fallback |

Whisper parity note: the EchoBridge reference transcript is produced by a server-side Whisper `medium.en` pipeline, so Sherpa Whisper Medium is a runtime/parity stress check rather than an independent human-labelled accuracy target. In this Pixel 6a run the INT8 Sherpa Whisper Medium row completed; the FP32 Sherpa Whisper Medium row was staged but did not produce a completed direct benchmark report before the dev target was lost, so it is kept behind the opt-in `sherpa-whisper-fp32-echobridge-perps-5m` preset and is not a recommended mobile default yet.

Additional streaming-decode smoke on the same Pixel 6a used `/long-audio-validation` with `streamAudioData` + `SegmentedOfflineAsrSession` over the first 60 seconds of the staged fixture. It completed successfully with 241 decoder chunks, 2 Sherpa offline ASR segments, 60.0 s processed audio, and 44.5 s wall time. This validates the compressed/decoded-stream orchestration path separately from the direct WAV benchmark.

Quantization note: the official k2-fsa Qwen3-ASR model-zoo artifact available for this run is INT8 only. Whisper Medium provides paired FP32/INT8 ONNX files, and the INT8 row completed on Pixel 6a. A true Whisper FP32-vs-INT8 quality/runtime comparison still needs a completed FP32 mobile run or a higher-memory device profile.
