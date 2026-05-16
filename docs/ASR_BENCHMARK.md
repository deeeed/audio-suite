# ASR Benchmark

## Purpose
This benchmark isolates Recorder-like ASR experiments in `apps/sherpa-voice` without changing the existing demo screen.

The page is designed to compare:
- practical live mobile models
- practical offline baselines
- heavier offline reference models

It intentionally does not benchmark only the likely winner. The matrix keeps weaker but useful baselines in place so tradeoffs are visible.

## Current Matrix
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

The Sherpa offline path uses the reusable `SegmentedOfflineAsrSession` JS helper from `@siteed/sherpa-onnx.rn`. It does not require a new native API: the app decodes audio into bounded mono 16 kHz PCM chunks, the session accumulates only one offline window at a time, calls `ASR.recognizeFromSamples`, emits segment/progress events, then optionally releases and reinitializes the Sherpa ASR runtime between windows.

Measured on Pixel 6a (`Pixel 6a - 16 - API 36`):

| Model | Mode | WER vs EchoBridge | CER vs EchoBridge | Runtime/session | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| Sherpa Qwen3-ASR 0.6B INT8 direct replay | offline segmented | 28.1% | 22.8% | 207.4 s | 10 × 30 s segments; best validated on-device text-quality candidate; not live-streaming |
| Moonshine Medium Streaming | offline/file | 38.0% | 28.2% | 183.9 s | live-capable; quality below Qwen3 |
| Moonshine Small Streaming | offline/file | 45.8% | 35.7% | 95.2 s | faster fallback |

Additional streaming-decode smoke on the same Pixel 6a used `/long-audio-validation` with `streamAudioData` + `SegmentedOfflineAsrSession` over the first 60 seconds of the staged fixture. It completed successfully with 241 decoder chunks, 2 Sherpa offline ASR segments, 60.0 s processed audio, and 44.5 s wall time. This validates the compressed/decoded-stream orchestration path separately from the direct WAV benchmark.

Quantization note: the official k2-fsa Qwen3-ASR model-zoo artifact available for this run is INT8 only. A true quantization-impact comparison needs a paired quantized/non-quantized Sherpa release, for example SenseVoice 2025 or Canary 180M, added as a separate benchmark matrix.
