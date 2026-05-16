# Moonshine + Sherpa Live Recording Example

Audio Playground includes two live validation surfaces that run two live pipelines from one microphone stream:

- Main Record tab: enable **Show Advanced Settings → Use Moonshine + Sherpa live transcription** to run the integrated live UX from the normal recorder controls.
- Dev-only `/moonshine-live` page: isolated prototype/debug surface for the same pipeline.

| Role | Library/model | Default | Notes |
| --- | --- | --- | --- |
| Live transcription | `@siteed/moonshine.rn` | Moonshine small or medium streaming EN | Small is the safer low-latency default on mid-range phones; medium is useful when quality is more important and the device can keep up. |
| Speaker turns | `@siteed/sherpa-onnx.rn` | Silero VAD v5 + `speaker-id-en-voxceleb` | Uses the current Sherpa ONNX Speaker ID model for tentative live clusters. It is not a replacement for full offline diarization quality checks. |

The recorder emits mono 16 kHz float chunks. The page fans each chunk out to Moonshine and to Sherpa `LiveSpeakerTurnSession`, then aligns Moonshine transcript lines to the nearest Sherpa turn by timestamp overlap.

## Validation recipe

```bash
yarn workspace audio-playground recipe:schema \
  scripts/agentic/teams/playground/flows/moonshine-live-screen-ready.json \
  scripts/agentic/teams/playground/recipes/moonshine-sherpa-live-validation.json

ADB_SERIAL=29071JEGR20638 yarn workspace audio-playground android:device:launch
ADB_SERIAL=29071JEGR20638 yarn workspace audio-playground recipe:run \
  scripts/agentic/teams/playground/recipes/moonshine-sherpa-live-validation.json \
  --device "Pixel 6a"

# Preferred Record-tab validation: readiness-gated controlled speech.
# The runner starts desktop TTS only after the app reports recording=true and Sherpa ready=true.
cd apps/playground
ADB_SERIAL=29071JEGR20638 ./scripts/agentic/run-record-moonshine-sherpa-live-validation.sh
```

For speaker-turn quality evidence, use the readiness-gated runner rather than starting speech manually. It uses two distinct macOS TTS voices (`Daniel` and `Karen` by default), waits for the live pipeline to be ready before speaking, keeps recording through a fixed speech window, then verifies clean stop state and that the transcript/speaker output remains visible on the result screen for visual validation. Override voices with `SAY_VOICE_1` / `SAY_VOICE_2` if needed.

If a freshly installed Android dev build has not been granted microphone/notification permissions yet, grant them once or accept the native prompts before running the recipe:

```bash
adb -s 29071JEGR20638 shell pm grant net.siteed.audioplayground.development android.permission.RECORD_AUDIO
adb -s 29071JEGR20638 shell pm grant net.siteed.audioplayground.development android.permission.POST_NOTIFICATIONS
```

## Pixel 6a validation snapshot

Validated on a Pixel 6a-class physical Android device (`Pixel 6a - 16 - API 36`) with controlled desktop TTS speech near the microphone.

### Main Record tab

| Metric | Result |
| --- | ---: |
| Recipe result | 23 / 23 passed |
| Speech driver | readiness-gated `say` voices: `Daniel` + `Karen` |
| Stop behavior | recipe waits for the full controlled speech window, then presses Stop |
| Result UX | transcript/speaker output remains visible on the stopped recording result screen |
| Moonshine chunks | 120 |
| Moonshine avg / max chunk latency | 498 ms / 2957 ms |
| Sherpa chunks | 291 |
| Sherpa avg / max chunk latency | 333 ms / 2950 ms |
| Sherpa max queue depth / drops | 191 / 0 |
| Speaker events | `speech_start`, `speech_end`, `speaker_pending`, `speaker_resolved`, `turn_final` |
| Final speaker turns | 9 |
| Transcript finalization | 2 committed attributed lines after stop |
| Late errors after stop | none (`moonshineSherpaError: null`) |

### Dev `/moonshine-live` page

| Metric | Result |
| --- | ---: |
| Recipe result | 13 / 13 passed |
| Recording duration | 3.1 s |
| Moonshine chunks | 14 |
| Moonshine avg / max chunk latency | 109 ms / 390 ms |
| Sherpa chunks | 14 |
| Sherpa avg / max chunk latency | 135 ms / 391 ms |
| Sherpa max queue depth / drops | 2 / 0 |
| Final speaker turns | 1 |


## Transcript quality replay

For transcript quality, do not use speaker/microphone loopback. Use the direct ASR benchmark runner: it stages a WAV into the app sandbox and feeds the identical PCM waveform into Moonshine offline/file transcription and simulated-live replay.

```bash
cd apps/playground
ADB_SERIAL=29071JEGR20638 \
BENCHMARK_DEVICE="Pixel 6a - 16 - API 36" \
BENCHMARK_PRESET=moonshine-sherpa-echobridge-perps-5m \
node scripts/agentic/direct-asr-benchmark.mjs
```

Reference source: EchoBridge server `WhisperService` with `medium.en` on the 5-minute `perps_controller_refactor_5m_16k_mono.wav` fixture. This is a backend-reference score, not human-labelled WER.

| Mode | Model | WER vs EchoBridge | CER vs EchoBridge | Init | Runtime | First partial | First commit | Commits |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Offline/file segmented | Sherpa Qwen3-ASR 0.6B INT8 | 28.1% | 22.8% | 4.8 s | 207.4 s | n/a | n/a | n/a |
| Offline/file | Moonshine Medium Streaming | 38.0% | 28.2% | 33.4 s | 183.9 s | n/a | n/a | n/a |
| Offline/file | Moonshine Small Streaming | 45.8% | 35.7% | 0.8 s | 95.2 s | n/a | n/a | n/a |
| Simulated live | Moonshine Medium Streaming | 38.0% | 28.2% | 1.7 s | 300.8 s | 4.2 s | 4.5 s | 90 |
| Simulated live | Moonshine Small Streaming | 46.4% | 35.8% | 2.0 s | 300.8 s | 4.2 s | 4.5 s | 91 |

Findings from this replay:

- Sherpa Qwen3-ASR 0.6B INT8 is the best validated on-device text-quality candidate in this benchmark: 28.1% WER vs 38.0% for Moonshine medium.
- Qwen3 is offline-only and is run through `SegmentedOfflineAsrSession`: PCM is submitted to Sherpa `ASR.recognizeFromSamples` in 30-second segments, progress is emitted after each finalized segment, and Android can release/reinitialize between segments to avoid retained native heap. The direct benchmark loads the 5-minute WAV first for reproducible scoring; `/long-audio-validation` validates the progressive decoder path.
- `/long-audio-validation` also validates the progressive decoder path: the first 60 seconds of the staged fixture completed on Pixel 6a with 241 decoder chunks, 2 Sherpa segments, 409 transcript chars, and 44.5 s wall time.
- Medium is the better Moonshine quality default when the device can afford it, but startup is much slower for full-file transcription.
- Simulated-live Moonshine quality closely matches full-file Moonshine quality on this fixture, which supports using direct PCM replay as the reproducible validation path for live UX.
- The official k2-fsa Qwen3-ASR artifact currently available in the model zoo is INT8 only, so this benchmark cannot measure Qwen3 quantization impact yet. To measure quantization impact on-device, add paired Sherpa releases that provide both quantized and non-quantized artifacts, such as SenseVoice 2025 or Canary 180M.

## Recommended use

- Use this page for UX validation of live transcript + tentative speaker attribution.
- Use Sherpa offline diarization for final speaker-turn quality comparisons.
- Use Sherpa Qwen3/offline ASR benchmarks for post-recording transcription quality; Qwen3 is not the live-streaming path.
