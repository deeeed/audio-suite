# Moonshine + Sherpa Live Recording Example

Audio Playground includes a dev-only `/moonshine-live` page that can run two live pipelines from one microphone stream:

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
```

For speaker-turn quality evidence, run the recipe while playing controlled speech near the device microphone. The recipe verifies model preparation, recording start, Moonshine transcript events, Sherpa speech/turn events, and rendered attributed transcript state.

If a freshly installed Android dev build has not been granted microphone/notification permissions yet, grant them once or accept the native prompts before running the recipe:

```bash
adb -s 29071JEGR20638 shell pm grant net.siteed.audioplayground.development android.permission.RECORD_AUDIO
adb -s 29071JEGR20638 shell pm grant net.siteed.audioplayground.development android.permission.POST_NOTIFICATIONS
```

## Pixel 6a validation snapshot

Validated on a Pixel 6a-class physical Android device (`Pixel 6a - 16 - API 36`) with controlled desktop TTS speech near the microphone.

| Metric | Result |
| --- | ---: |
| Recipe result | 13 / 13 passed |
| Recording duration | 3.1 s |
| Moonshine chunks | 14 |
| Moonshine avg / max chunk latency | 109 ms / 390 ms |
| Sherpa chunks | 14 |
| Sherpa avg / max chunk latency | 135 ms / 391 ms |
| Sherpa max queue depth / drops | 2 / 0 |
| Speaker events | `speech_start`, `speech_end`, `speaker_pending`, `speaker_resolved`, `turn_final` |
| Final speaker turns | 1 |
| Transcript finalization | 1 committed attributed line after stop |

## Recommended use

- Use this page for UX validation of live transcript + tentative speaker attribution.
- Use Sherpa offline diarization for final speaker-turn quality comparisons.
- Use Sherpa Qwen3/offline ASR benchmarks for post-recording transcription quality; Qwen3 is not the live-streaming path.
