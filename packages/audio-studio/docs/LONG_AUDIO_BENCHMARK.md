# Long audio ASR benchmark

Snapshot date: 2026-05-14. Default fixture:
`.agent/fixtures/perps_controller_refactor_100m.opus`.

This benchmark proves that very long compressed-audio decode + transcription can
reach `progress=1` without crashing. It is a runtime/memory benchmark, not a
formal WER/transcription-quality benchmark.

## Comparable Android long-run results

These are the only apples-to-apples performance rows today: same physical
Android device, same Opus fixture, same harness, Android memory sampling.

| Platform | Engine/model | Mode | Audio processed | Wall time | Chunks | ASR segments | Transcript chars | Peak PSS | Peak native heap | Result |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Android physical device | Decode only | streaming decode | 1h 40m 24s | 9m 40s | 24,098 | n/a | 0 | 689.7 MB | 128.2 MB | PASS |
| Android physical device | Moonshine `moonshine-small-streaming-en` | streaming ASR | 1h 40m 24s | 1h 57m 22s | 24,098 | n/a | 50,176 | 1,216.6 MB | 674.7 MB | PASS |
| Android physical device | Sherpa ONNX Qwen3 | offline 30s segments, release between segments | 1h 40m 24s | 1h 44m 51s | 24,098 | 201 | 50,793 | 2,714.9 MB | 2,390.3 MB | PASS |

## iOS physical-device validation rows

These rows are from a physical iPhone 12. They are real device evidence
for the iOS path, but they are not hardware-comparable with the Android rows.
iOS memory sampling is not implemented in this harness yet.

| Platform | Engine/model | Mode | Audio processed | Wall time | Chunks | Transcript chars | Peak PSS | Result |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| iOS physical iPhone 12 | Decode only | streaming decode | 1h 42m 57s | 1m 03s | 24,098 | 0 | n/a | PASS |
| iOS physical iPhone 12 | Moonshine `moonshine-small-streaming-en` | streaming ASR | 1h 42m 57s | 1h 31m 26s | 24,098 | 50,975 | n/a | PASS |

## iOS physical Sherpa/Qwen3 checks

The Qwen3 model was copied from the Android app sandbox to host
`.agent/sherpa-models/qwen3-asr-0.6B-int8-2026-03-25`, then staged into the
iOS app data container with `xcrun devicectl device copy to`. The harness now
also supports host-side model staging via `--stage-sherpa-model-host-dir`.

| Platform | Engine/model | Config | Audio processed | Wall time | Chunks | Segments | Transcript chars | Result |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| iOS physical iPhone 12 | Sherpa ONNX Qwen3 | low-memory: `numThreads=1`, `maxTotalLen=256`, `maxNewTokens=64` | 5s | 4.8s | 20 | 1 | 9 | PASS |
| iOS physical iPhone 12 | Sherpa ONNX Qwen3 | low-memory: `numThreads=1`, `maxTotalLen=256`, `maxNewTokens=64` | 30s | 7.9s | 120 | 1 | 8 | PASS |
| iOS physical iPhone 12 | Sherpa ONNX Qwen3 | Android-like: `numThreads=4`, `maxTotalLen=512`, `maxNewTokens=128` | 30s | n/a | n/a | n/a | n/a | FAIL: app left CDP/process |
| iOS physical iPhone 12 | Sherpa ONNX Qwen3 | low-memory: `numThreads=1`, `maxTotalLen=256`, `maxNewTokens=64` | 5m | n/a | n/a | n/a | n/a | FAIL: app left CDP/process |

## iOS simulator validation rows, not comparable performance

These rows prove the iOS runtime path completes and produces transcripts, but
they should **not** be compared directly to Android timings. They run in an iOS
simulator on the host Mac using AVFoundation and host CPU, while Android rows run
on a physical phone through Android `MediaCodec`. iOS memory sampling is also not
implemented in the harness.

| Platform | Engine/model | Mode | Audio processed | Wall time | Chunks | Transcript chars | Peak PSS | Result |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| iOS simulator `playground-1` | Decode only | streaming decode | 1h 42m 57s | 24.5s | 24,098 | 0 | n/a | PASS / simulator-only timing |
| iOS simulator `playground-1` | Moonshine `moonshine-small-streaming-en` | streaming ASR | 1h 42m 57s | 28m 30s | 24,098 | 50,975 | n/a | PASS / simulator-only timing |

## Android decode-only controls by format

| Fixture | Audio processed | Wall time | Chunks | Peak PSS | Peak native heap | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Opus | 1h 40m 24s | 9m 40s | 24,098 | 689.7 MB | 128.2 MB | PASS |
| MP3 | 1h 40m 24s | 3m 43s | 24,098 | 493.7 MB | 119.9 MB | PASS |
| M4A/AAC | 1h 40m 24s | 1m 11s | 24,098 | 467.7 MB | 119.9 MB | PASS |

## Short format ASR smokes

These prove Opus/MP3/M4A all reach the same post-decode ASR path. Full 100m ASR
was run on Opus; MP3/M4A are covered by full-length decode plus short ASR smoke
because the ASR receives normalized 16 kHz mono PCM after platform decode.

| Platform | Engine/model | Fixture | Audio processed | Wall time | Chunks | Segments | Transcript chars | Peak PSS | Peak native heap | Result |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Android | Moonshine small streaming | MP3 | 30s | 8.4s | 120 | n/a | 127 | 679.0 MB | 151.8 MB | PASS |
| Android | Moonshine small streaming | M4A/AAC | 30s | 8.0s | 121 | n/a | 136 | 668.9 MB | 153.6 MB | PASS |
| iOS simulator | Moonshine small streaming | MP3 | 30s | 3.0s | 121 | n/a | 118 | n/a | n/a | PASS |
| iOS simulator | Moonshine small streaming | M4A/AAC | 30s | 2.9s | 121 | n/a | 134 | n/a | n/a | PASS |
| Android | Sherpa ONNX Qwen3 | Opus | 30s | 17s | 121 | 2 | 140 | 2,655.5 MB | 2,406.0 MB | PASS |
| Android | Sherpa ONNX Qwen3 | MP3 | 30s | 15.5s | 120 | 1 | 144 | 487.6 MB | 146.4 MB | PASS |
| Android | Sherpa ONNX Qwen3 | M4A/AAC | 30s | 21.5s | 121 | 2 | 145 | 475.6 MB | 144.7 MB | PASS |

## Sherpa/Qwen3 scale checks on Android

| Segmenting | Audio processed | Wall time | Segments | Transcript chars | Peak PSS | Peak native heap | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 30s segments, release between segments | 30s | 17s | 2 | 140 | 2,655.5 MB | 2,406.0 MB | PASS |
| 30s segments, release between segments | 2m | 1m 38s | 5 | 921 | 1,503.2 MB | 1,245.5 MB | PASS |
| 30s segments, release between segments | 5m | 4m 40s | 11 | 1,882 | 2,716.8 MB | 2,318.1 MB | PASS |
| 30s segments, release between segments | 10m | 8m 30s | 21 | 2,114 | 2,652.4 MB | 2,291.6 MB | PASS |
| 30s segments, release between segments | full 100m | 1h 44m 51s | 201 | 50,793 | 2,714.9 MB | 2,390.3 MB | PASS |
| larger/single segment stress | 5m | n/a | n/a | n/a | n/a | n/a | FAIL: app process exited |

## Interpretation

- The root Moonshine VAD-retention fix is validated by full 100m Moonshine runs
  on Android physical device, iOS physical iPhone 12, and iOS simulator.
- Only rows within the same device class are comparable for performance today.
  The iOS physical rows are valid real-device completion evidence, but should
  not be read as an Android-vs-iOS hardware comparison. The iOS simulator decode
  time remains simulator-only completion evidence.
- Sherpa ONNX Qwen3 completes the full 100m run on Android only when using
  bounded 30-second offline segments with release/reinitialize between segments.
- Android Sherpa/Qwen3 was faster than Android Moonshine in the full run
  (`1h44m51s` vs `1h57m22s`), but it used a much larger peak memory envelope
  (`2.7 GB` PSS / `2.39 GB` native vs Moonshine `1.2 GB` PSS / `675 MB` native).
- Android decode-only controls show that decode itself is not the long-run memory
  problem; ASR/model lifecycle dominates memory.
- A larger/single-segment Sherpa stress run crashed the app, so long Sherpa files
  should use bounded segmentation today.
- iOS Sherpa/Qwen3 is not benchmarked yet. The current Qwen3 config is Android
  sandbox-path based, and iOS model staging for Sherpa is not wired into the
  validation harness.
- iOS memory sampling is not implemented in the current harness, so iOS rows only
  prove runtime completion and wall time.
- iOS physical fixture staging is now wired through `xcrun devicectl device copy
  to` into the app data container, so future physical-device validation does not
  require manual file import.
- iOS physical Sherpa/Qwen3 is only a short-smoke PASS on the iPhone 12 today.
  The 30s Android-like config and the 5m low-memory config both made the app
  leave CDP and terminate. Treat Qwen3 on this 4 GB-class iPhone as not
  long-audio-ready until we add iOS memory sampling and/or a smaller Qwen3
  variant/quantization.
- Transcript character counts are only sanity signals that text was produced;
  they are not quality/WER metrics.

## Evidence files

Focused summary:

- `.agent/validation-logs/focused-benchmark-summary-20260514T095650Z.log`

Long-run evidence:

- Android decode-only Opus full:
  `.agent/validation-logs/validate-stream-long-android-decode-full-opus-focused-20260514T094620Z.jsonl`
- iOS decode-only Opus full:
  `.agent/validation-logs/validate-stream-long-ios-decode-full-opus-focused-20260514T094139Z.jsonl`
- iOS physical decode-only Opus full:
  `.agent/validation-logs/validate-stream-long-ios-physical-decode-full-20260514T110327Z.jsonl`
- Android Moonshine Opus full:
  `.agent/validation-logs/validate-stream-long-android-moonshine-full-vadfix-20260514T062106Z.jsonl`
- iOS Moonshine Opus full:
  `.agent/validation-logs/validate-stream-long-ios-moonshine-full-vadfix-20260514T085020Z.jsonl`
- iOS physical Moonshine Opus full:
  `.agent/validation-logs/validate-stream-long-ios-physical-moonshine-full-20260514T110606Z.jsonl`
- Android Sherpa/Qwen3 Opus full:
  `.agent/validation-logs/validate-stream-long-android-qwen3-full-30s-release-between-20260514T032814Z.jsonl`
- iOS physical Sherpa/Qwen3 5s low-memory smoke:
  `.agent/validation-logs/validate-stream-long-ios-physical-qwen3-5s-lowmem-20260514T130650Z.jsonl`
- iOS physical Sherpa/Qwen3 30s low-memory smoke:
  `.agent/validation-logs/validate-stream-long-ios-physical-qwen3-30s-lowmem-20260514T130822Z.jsonl`
- iOS physical Sherpa/Qwen3 30s Android-like config failure:
  `.agent/validation-logs/validate-stream-long-ios-physical-qwen3-30s-20260514T130309Z.jsonl`
- iOS physical Sherpa/Qwen3 5m low-memory failure:
  `.agent/validation-logs/validate-stream-long-ios-physical-qwen3-5m-lowmem-20260514T130953Z.jsonl`

Format evidence:

- Android decode-only MP3 full:
  `.agent/validation-logs/validate-stream-long-android-decode-full-mp3-20260514T051957Z.jsonl`
- Android decode-only M4A full:
  `.agent/validation-logs/validate-stream-long-android-decode-full-m4a-20260514T052510Z.jsonl`
- Android Moonshine MP3 30s:
  `.agent/validation-logs/validate-stream-long-android-moonshine-mp3-30s-focused-20260514T094252Z.jsonl`
- Android Moonshine M4A 30s:
  `.agent/validation-logs/validate-stream-long-android-moonshine-m4a-30s-focused-20260514T094336Z.jsonl`
- iOS Moonshine MP3 30s:
  `.agent/validation-logs/validate-stream-long-ios-moonshine-mp3-30s-focused-20260514T094426Z.jsonl`
- iOS Moonshine M4A 30s:
  `.agent/validation-logs/validate-stream-long-ios-moonshine-m4a-30s-focused-20260514T094515Z.jsonl`
- Android Sherpa/Qwen3 MP3 30s:
  `.agent/validation-logs/validate-stream-long-android-qwen3-mp3-30s-20260514T052717Z.jsonl`
- Android Sherpa/Qwen3 M4A 30s:
  `.agent/validation-logs/validate-stream-long-android-qwen3-m4a-30s-20260514T052815Z.jsonl`
