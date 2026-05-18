# Live ASR Recommendation

## Recommendation

For Pixel-class mobile hardware, the practical open-source path is a hybrid:

1. **Moonshine Medium Streaming** for live draft captions on devices that pass the RTF/backlog/memory gate.
2. **Moonshine Small Streaming** as the lower-memory/lower-backlog live fallback.
3. **Sherpa VAD + Speaker ID** for tentative live speaker-turn labels.
4. **Sherpa Qwen3-ASR 0.6B INT8** as the delayed/refinement and practical final-transcript candidate.
5. **Sherpa Whisper Medium INT8** as the EchoBridge Whisper parity/stress row, not as a default live model.
6. **Offline/windowed diarization** remains the final speaker-label quality pass.

Moonshine speaker identification is intentionally not the default speaker-turn path in this benchmark; Sherpa VAD + Speaker ID owns tentative live turns so the app does not run duplicate speaker trackers by default.

Do **not** spend default benchmark time on the tested Sherpa Zipformer streaming rows. The direct Python `sherpa-onnx==1.13.2` compatibility check showed the same bad greedy-search transcripts as the RN wrapper on the checked fixtures, so the current issue is model/output quality rather than a primary RN bridge bug. Keep that evidence in [ASR_ZIPFORMER_INVESTIGATION.md](./ASR_ZIPFORMER_INVESTIGATION.md), but exclude Zipformer from the practical matrix.

Google Recorder remains the UX bar, but it likely uses proprietary Google/Pixel-optimized ASR. In this repo, Moonshine is the best open true-live draft candidate after RN transport coalescing, while Qwen3/Whisper are better delayed/final quality paths.

## Product decision table

| Product need                | Current default                                    | Alternate                                                              | Do not use as default                                            |
| --------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| True-live captions          | Moonshine Medium Streaming on capable devices      | Moonshine Small Streaming for lower-memory/lower-backlog fallback      | Current Zipformer rows; offline Whisper/Qwen as instant captions |
| Live speaker turns          | Sherpa VAD + Speaker ID                            | Offline diarization after stop/finalization                            | Treating tentative live speaker ID as final diarization          |
| Delayed high-quality live   | Sherpa Qwen3-ASR 0.6B INT8 rolling/bounded windows | Sherpa Whisper Medium INT8 if Whisper parity matters more than latency | Presenting rolling offline as true streaming                     |
| Final transcript after stop | Sherpa Qwen3-ASR 0.6B INT8 segmented offline       | Sherpa Whisper Medium INT8 parity row                                  | Moonshine draft as final transcript quality                      |
| EchoBridge parity           | Sherpa Whisper Medium INT8                         | Sherpa Whisper Small                                                   | Interpreting Whisper-vs-Whisper scores as human-labelled WER     |

## True-live gate

A model is eligible as the default true-live engine only if it sustains:

- processing real-time factor below `1.0×`
- bounded max backlog; target `0s`, reject if backlog grows over a long run
- wall real-time factor near or below `1.0×` on non-clock-paced paths; in simulated-live replay, wall RTF is clock-paced and should be treated as a session-duration sanity check, not the capacity signal
- first useful partial under ~2s on short clips and acceptable first useful text on meeting audio
- no crash or unbounded memory growth
- acceptable WER/CER on reference clips

## Current Pixel 6a evidence

Device: Pixel 6a (`<adb-serial>`, Android 16 / API 36). Harness: Audio Playground `/asr-benchmark` through `direct-asr-benchmark.mjs`. Memory delta is app PSS from `adb shell dumpsys meminfo` before/after each run; it is a stability signal, not a precise retained-heap measurement.

### JFK 11s reference clip

| Model                                                | Runtime         |  WER | First partial | First commit | Wall RTF | Processing RTF | Max backlog | Memory delta | Result                                                                    |
| ---------------------------------------------------- | --------------- | ---: | ------------: | -----------: | -------: | -------------: | ----------: | -----------: | ------------------------------------------------------------------------- |
| Moonshine Small Streaming, 600ms coalesced transport | streaming       | 0.0% |         0.82s |        2.69s |    1.13× |          0.33× |        0.0s |      +29.0MB | Lower-memory live fallback; no JFK backlog, but wall RTF still above 1.0× |
| Sherpa Qwen3-ASR 0.6B INT8                           | rolling-offline | 0.0% |         3.86s |        3.86s |    1.36× |          0.35× |        0.0s |      +42.9MB | Good delayed-live/final quality, not true streaming                       |

Moonshine Small optimized-transport artifact: `apps/playground/.agent/reports/direct-asr-benchmark-2026-05-17T14-54-17-966Z.md` (19 coalesced chunks instead of 55, processing RTF 0.33×, max backlog 0.0s). Moonshine Medium was also checked before this coalescing change on the JFK clip: 0.0% WER, 0.80s first partial, 2.95s first commit, 1.11× wall RTF, +28.0MB simulated-live PSS delta.

### Recorder 22.7s performance clip

No exact reference transcript is committed for this clip, so only responsiveness was used.

| Model                      | Runtime         | First partial | First commit | Wall RTF | Processing RTF | Max backlog | Observation                                                                  |
| -------------------------- | --------------- | ------------: | -----------: | -------: | -------------: | ----------: | ---------------------------------------------------------------------------- |
| Moonshine Small Streaming  | streaming       |         1.23s |        2.44s |    1.08× |          0.87× |        5.2s | Better readable text than the rejected streaming baselines, but backlog grew |
| Sherpa Qwen3-ASR 0.6B INT8 | rolling-offline |         9.40s |        9.40s |    1.32× |          0.58× |        1.8s | Delayed but higher quality-looking text                                      |

### EchoBridge Perps 5-minute referenced meeting fixture

Runtime label note: `rolling-offline` means bounded-window simulated delayed-live replay; `segmented offline` means pure file-mode offline processing after audio is available.

Reference source: EchoBridge server `WhisperService` with `medium.en`. These WER/CER values are backend-reference scores, not human-labelled WER.

| Model                                                 | Mode              |   WER |   CER | First partial | First commit | Wall RTF | Processing RTF | Max backlog | Memory delta | Result                                                                     |
| ----------------------------------------------------- | ----------------- | ----: | ----: | ------------: | -----------: | -------: | -------------: | ----------: | -----------: | -------------------------------------------------------------------------- |
| Moonshine Medium Streaming, 600ms coalesced transport | simulated live    | 37.7% | 27.7% |         4.0s |        4.4s |    1.00× |          0.45× |        1.0s |     +252.8MB | Best Moonshine live-draft candidate; still too rough for final transcript  |
| Moonshine Small Streaming, 600ms coalesced transport  | simulated live    | 47.6% | 35.5% |         4.0s |        4.6s |    1.00× |          0.33× |        0.3s |     +120.0MB | Lower-backlog fallback; long-form quality is poor                          |
| Sherpa Qwen3-ASR 0.6B INT8                            | segmented offline | 28.1% | 22.8% |           n/a |          n/a |      n/a |            n/a |         n/a |          n/a | Practical non-Whisper final/delayed pass                                   |
| Sherpa Whisper Medium INT8                            | segmented offline | 19.5% | 16.3% |           n/a |          n/a |      n/a |            n/a |         n/a |          n/a | Best completed EchoBridge/Whisper parity row, too slow for default live UX |

Current practical matrix artifact:

- `apps/playground/.agent/reports/direct-asr-benchmark-2026-05-18T00-48-26-710Z.md` — full practical 5-minute Pixel 6a matrix after Android LAN Metro host fix

Conclusion: Moonshine can now keep up on a Pixel 6a-class device after coalescing, but it does not deliver high-quality final meeting transcription. A Recorder-like UX should display Moonshine live draft text and speaker-turn hints, then replace/refine with segmented Sherpa Qwen3/Whisper and offline diarization.

## Direct Python compatibility note

See [ASR_ZIPFORMER_INVESTIGATION.md](./ASR_ZIPFORMER_INVESTIGATION.md). The official `sherpa-onnx==1.13.2` Python runtime produced comparable bad outputs to the RN benchmark for both checked Zipformer rows. This is useful compatibility evidence because it prevents spending PR time on an RN-only bug hunt for those model artifacts; it is not part of the practical model recommendation.

## How to reproduce

Run the practical 5-minute recommendation matrix:

```bash
cd apps/playground
ADB_SERIAL=<adb-serial> \
BENCHMARK_DEVICE="Pixel 6a - 16 - API 36" \
BENCHMARK_PRESET=mobile-asr-recommendation-echobridge-perps-5m \
BENCHMARK_SIMULATED_TIMEOUT_MS=600000 \
BENCHMARK_OFFLINE_TIMEOUT_MS=1800000 \
node scripts/agentic/direct-asr-benchmark.mjs
```

Run a short true-live sanity pass:

```bash
cd apps/playground
ADB_SERIAL=<adb-serial> \
BENCHMARK_DEVICE="Pixel 6a - 16 - API 36" \
BENCHMARK_CLIPS=jfk-public-quote \
BENCHMARK_MODELS=moonshine-small-streaming-en,moonshine-medium-streaming-en,sherpa-qwen3-asr-0.6b-int8 \
BENCHMARK_SIMULATED_TIMEOUT_MS=600000 \
BENCHMARK_OFFLINE_TIMEOUT_MS=600000 \
node scripts/agentic/direct-asr-benchmark.mjs
```

Model downloads are disabled by default. Add `BENCHMARK_ALLOW_MODEL_DOWNLOAD=1` the first time a Sherpa model must be staged.

Every `direct-asr-benchmark.mjs` report includes reproducibility metadata in JSON: git commit/dirty state, package versions, device build fingerprint, selected clips with SHA-256, and configured model file hashes on-device. Re-run the same commands after updating Moonshine, sherpa-onnx, or upstream model artifacts and compare the report metadata before changing this recommendation.

## Follow-ups

- Re-run the 5-minute referenced meeting fixture after every Moonshine/sherpa-onnx/model update before changing defaults.
- Add VAD-bounded rolling windows for Qwen3 instead of fixed 15s windows.
- Pair live ASR evidence with Sherpa VAD + Speaker ID validation so the final product choice covers both draft transcript and live speaker turns.
- Investigate newer streaming models or platform-native accelerators if Google Recorder-level true-live quality is required.
