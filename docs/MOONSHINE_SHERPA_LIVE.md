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

## Recommended use

- Use this page for UX validation of live transcript + tentative speaker attribution.
- Use Sherpa offline diarization for final speaker-turn quality comparisons.
- Use Sherpa Qwen3/offline ASR benchmarks for post-recording transcription quality; Qwen3 is not the live-streaming path.
