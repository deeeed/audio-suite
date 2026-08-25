# On-device diarization benchmark

Last updated: 2026-08-25.

## Recommendation

For accurate final speaker labels on Apple devices, use FluidAudio's offline
Community-1/VBx pipeline. It has the strongest public mobile-ready evidence and
the best independently reproduced result in this comparison.

For Android or one shared iOS/Android implementation, use Sherpa ONNX offline
diarization only when the application can supply the speaker count. Its quality
on ES2004a is close to FluidAudio in that mode. Do not claim accurate automatic
diarization. The default automatic-count run returned 68 speakers for a
4-speaker meeting and 67.89% DER. Threshold 0.8, selected on separate IS1001a
windows, still returned 37 speakers and 42.92% DER.

Do not use Moonshine speaker attribution for accurate final diarization. It is
useful for live speaker hints attached to transcript lines, but it under-counted
speakers and averaged about 60 to 63% DER on the short AMI stress set.

Quality decides the ranking. Runtime, memory, model size, and power matter only
after a system clears the quality gate.

## Versioned benchmark contract

[`manifest.json`](../../../benchmarks/on-device-diarization/manifest.json) is the
single place that pins the AMI split, reference commit, scoring profiles,
quality gates, runtime versions, model revisions, model hashes, and selected
settings. Runners read it and fail on checksum or model-revision drift.

When a runtime or model changes:

1. Change its version, revision, hash, size, and settings in the manifest.
2. Increment `benchmarkVersion`.
3. Run the smoke windows. Tune only on those development windows.
4. Freeze the settings, then run the untouched 16-meeting AMI test split.
5. Run original-runtime parity on macOS or Python and the iOS simulator lane.
6. Run WER and cpWER with the same timestamped ASR hypothesis.
7. Add a dated result JSON and run `yarn verify:diarization-benchmark`.

Do not replace an old result when upgrading a model. Add a new result so
quality regressions remain visible.

## Current evidence

Primary scores use the common AMI profile: 0.25-second collar, overlapped speech
excluded, and the full clip as the evaluation map. Strict scores use no collar
and include overlap. Both use `pyannote.metrics==4.0.0`.

| System                                    | Audio                              | Speaker count             | Standard DER | Standard JER | Strict DER | Strict JER |
| ----------------------------------------- | ---------------------------------- | ------------------------- | -----------: | -----------: | ---------: | ---------: |
| FluidAudio 0.15.6 offline VBx             | AMI test, 16 full meetings         | automatic, exact on 13/16 |    **9.01%** |   **14.16%** |     23.35% | **29.70%** |
| Sherpa ONNX, Pyannote 3.0 + TitaNet small | ES2004a, 17.5 min                  | supplied as 4, detected 4 |       11.30% |       15.03% | **22.71%** |     29.32% |
| Sherpa ONNX, Pyannote 3.0 + ERes2Net      | ES2004a, 17.5 min                  | automatic, 68/4           |       67.89% |       60.65% |     75.71% |     69.81% |
| Moonshine small streaming                 | IS1001a stress windows, 80 s total | automatic, mean 1.7/3.3   |       60.08% |       71.13% |     61.82% |     74.80% |
| Moonshine medium streaming                | IS1001a stress windows, 80 s total | automatic, mean 1.7/3.3   |       63.49% |       71.08% |     62.71% |     74.81% |

The Moonshine rows are a live-attribution stress test, not an offline clustering
benchmark. That distinction does not rescue the quality result. A user receives
missing or wrong speaker labels either way.

An option earns an "accurate" recommendation only if its automatic-count mode
finishes every meeting in the official 16-meeting AMI test split, stays at or
below 15% macro DER and 25% macro JER, and returns the exact speaker count on at
least 12 of 16 meetings. Known-count results cannot satisfy this gate.

FluidAudio reports 10.62% average DER and 17.4% average JER across the same full
AMI split, with the correct count on 12 of 16 meetings. Our independent run
finished at 9.01% DER, 14.16% JER, and 13 correct counts. ES2004a scored 8.97%
DER in our run versus FluidAudio's published 10.4%.

Upstream Sherpa parity is exact. Native Python `sherpa-onnx==1.13.0` on macOS
produced the same segment counts, speaker counts, DER, and JER as the Pixel RN
build for known count, automatic threshold 0.5, and automatic threshold 0.8.
The automatic-clustering failure is upstream behavior, not an Android or React
Native bridge regression.

## Transcript quality

WER measures the words and says nothing about who spoke them. cpWER concatenates
words by speaker, finds the lowest-error one-to-one speaker mapping, and then
computes word error rate. It measures the final attributed transcript.

The shared-ASR comparison below uses the same native FluidAudio Parakeet TDT v3
word hypotheses and timestamps for every diarizer. Its chronological WER on
ES2004a is 32.08%. AMI has overlapped speech, so this single-stream WER depends
on how simultaneous reference words are ordered. cpWER is the more useful
meeting-transcript metric.

| Diarizer on ES2004a              | Speaker mode    | Shared-ASR WER | Shared-ASR cpWER | Oracle-word cpWER |
| -------------------------------- | --------------- | -------------: | ---------------: | ----------------: |
| FluidAudio offline VBx           | automatic, 4/4  |         32.08% |       **39.15%** |        **28.21%** |
| Sherpa + TitaNet small           | supplied 4, 4/4 |         32.08% |           41.06% |            29.28% |
| Sherpa + ERes2Net, threshold 0.8 | automatic, 37/4 |         32.08% |           82.67% |            84.75% |
| Sherpa + ERes2Net, threshold 0.5 | automatic, 68/4 |         32.08% |          126.29% |           136.82% |

Oracle-word cpWER assigns the official reference words to the predicted speaker
segments. WER is zero by construction. This isolates speaker attribution from
recognition errors. Values above 100% are valid because extra speaker streams
create insertions.

The native Moonshine Swift 0.1.5 runtime was also run directly, without React
Native, on the three IS1001a stress windows. Small scored 75.12% weighted WER
and medium scored 69.76%. Both scored 87.80% cpWER and under-counted speakers on
every clip. This independently reproduces the quality problem in upstream
Moonshine. It does not prove byte-for-byte parity with the Android wrapper.

## Efficiency and native parity

Inference timing excludes model download and compilation. RTFx is audio seconds
divided by processing seconds. Compare timing only on the same host hardware and
build class. Quality must pass first.

| Runtime                             | Host                      | Process time |  RTFx | Standard DER | Parity                          |
| ----------------------------------- | ------------------------- | -----------: | ----: | -----------: | ------------------------------- |
| FluidAudio 0.15.6 macOS native      | M5 Max                    |        4.08s | 257.5 |        8.97% | Reference                       |
| FluidAudio 0.15.6 iOS simulator     | Same M5 Max, `audiolab-1` |       46.68s |  22.5 |        8.97% | Exact same 95 segments as macOS |
| Sherpa 1.13.0 Python, known count   | M5 Max                    |       56.51s |  18.6 |       11.30% | Exact Pixel segment parity      |
| Sherpa 1.13.0 Pixel 6a, known count | Pixel 6a, debug app       |      272.05s |   3.9 |       11.30% | Exact Python segment parity     |

The iOS simulator proves API and algorithm parity, not physical iPhone speed.
The same 95 segments and scores matter more than the 11.5-fold simulator timing
gap versus native macOS.

Sherpa's Python runtime and Pixel wrapper produced byte-for-byte identical
segments in the known-count and both automatic-count cases. On the same M5 Max,
Python processed the known-count case at 18.6 RTFx. The Pixel 6a reached 3.9
RTFx. This is an efficiency comparison for one algorithm, not evidence that the
automatic result is usable.

For a full Python Pyannote reference, create a Python 3.10 or 3.11 environment,
accept the gated Community-1 model terms, and provide `HF_TOKEN`:

```bash
python -m pip install \
  -r scripts/diarization-benchmark/requirements-pyannote.txt
python apps/sherpa-voice/scripts/diarization-pyannote-python.py \
  --wav /path/to/ES2004a.Mix-Headset.wav \
  --device mps \
  --out pyannote-es2004a.json
```

Score its output with the same `score:diarization-report` command. Record model
initialization separately, and compare warm `processSeconds`, RTFx, DER, and JER
against the native and simulator rows. A mobile or converted model is close to
Python only if it first stays within the manifest's quality tolerance. Report
the speed ratio after that. A faster 40% DER pipeline has no useful parity with
a 10% DER reference.

## What is being compared

| Option                              | Platforms             | Accurate offline mode                  | Automatic count   | Decision                                           |
| ----------------------------------- | --------------------- | -------------------------------------- | ----------------- | -------------------------------------------------- |
| FluidAudio offline Community-1/VBx  | iOS, macOS            | Yes                                    | Yes               | Recommend on Apple                                 |
| Sherpa ONNX offline diarization     | Android, iOS, desktop | Yes when count is known                | Failed            | Conditional recommendation                         |
| Moonshine 0.1.5 speaker attribution | Android, iOS          | No standalone final diarization output | Yes               | Live hints only                                    |
| FluidAudio LS-EEND or Sortformer    | iOS, macOS            | Streaming models                       | Fixed slot limits | Keep as streaming candidates, benchmark separately |
| Pyannote Community-1 Python         | Desktop/server        | Yes                                    | Yes               | Reference system, not a mobile runtime             |

FluidAudio is Apache-2.0. Its offline pipeline uses permissively licensed
Pyannote segmentation and WeSpeaker model assets. Sherpa ONNX is Apache-2.0.
Moonshine's English streaming code and models are MIT. Sortformer uses the
NVIDIA Open Model License, so it belongs in a separate licensing row rather
than under the permissive-model claim.

## Reproduction contract

The benchmark pins the official only-words RTTM setup from
`BUTSpeechFIT/AMI-diarization-setup` at commit
`2509d8933721023fab4def2618aabd5c28eb82e9`. This matches the published AMI
full-corpus-ASR split and avoids the inconsistent vocal-sound annotations.

The full meeting used here is `ES2004a.Mix-Headset.wav`:

```text
duration: 1049.354688 seconds
sha256: 3e2560b19bee6952c7c7ce041b0f1ea8a7ea9468044c4eea79d2a2c67e24ab0f
reference speakers: 4
```

Run the reference parser test from the repository root:

```bash
yarn test:diarization-reference
```

Create the pinned scoring environment once:

```bash
python3 -m venv /tmp/audiolab-pyannote
/tmp/audiolab-pyannote/bin/python -m pip install \
  -r scripts/diarization-benchmark/requirements.txt
```

Run the native macOS FluidAudio parity meeting, or set
`BENCHMARK_SCOPE=full` for all 16 test meetings:

```bash
AMI_AUDIO_ROOT=/path/to/amicorpus \
PYANNOTE_PYTHON=/path/to/python-with-pyannote-metrics \
yarn benchmark:diarization:macos
```

Run upstream Sherpa Python after creating a Python 3.10 or 3.11 environment
with `sherpa-onnx==1.13.0`:

```bash
AMI_AUDIO_ROOT=/path/to/amicorpus \
SHERPA_PYTHON=/path/to/python-with-sherpa-onnx \
PYANNOTE_PYTHON=/path/to/python-with-pyannote-metrics \
yarn benchmark:diarization:sherpa-python
```

Run Sherpa Voice on a connected Android device after downloading the
segmentation and embedding models in the app:

```bash
cd apps/sherpa-voice
AMI_AUDIO_ROOT=/path/to/amicorpus \
BENCHMARK_SUITE=parity \
BENCHMARK_PROFILE=primary \
PYANNOTE_PYTHON=/path/to/python-with-pyannote-metrics \
ANDROID_SERIAL=your-device-serial \
yarn diarization:benchmark:android
```

Profiles are `auto`, `oracle`, `primary`, `finalists`, and `full`. Use `auto`
for the recommendation. `oracle` is only an upper-bound diagnostic.
Set `SHERPA_AUTO_THRESHOLDS=0.8,0.9,1.0` to tune on a separate development set
before freezing one value for the test set.

Run the pinned FluidAudio lane on the local iOS simulator. The runner defaults
to `audiolab-1`, verifies the audio checksum and current Hugging Face model
revision, builds a temporary Swift Package, preserves raw logs, and optionally
scores the result:

```bash
AMI_AUDIO_ROOT=/path/to/amicorpus \
PYANNOTE_PYTHON=/path/to/python-with-pyannote-metrics \
yarn benchmark:diarization:ios-simulator
```

The macOS and simulator lanes default to three iterations and report the median.
They share a host lock, so a second timed lane fails instead of corrupting both
timings.

Sherpa Python and Pixel figures are single runs because each automatic case is
long. Treat their RTFx as indicative until both lanes use repeated medians.

Run the Moonshine live-attribution stress benchmark from the playground app:

```bash
cd apps/playground
AMI_AUDIO_ROOT=/path/to/amicorpus \
AMI_WORDS_ROOT=/path/to/ami-annotations/words \
PYANNOTE_PYTHON=/path/to/python-with-pyannote-metrics \
ANDROID_SERIAL=your-device-serial \
yarn benchmark:moonshine:diarization
```

Re-score an existing report against the pinned official reference:

```bash
yarn score:diarization-report \
  --input /path/to/report.json \
  --out /path/to/report-official.json \
  --python /path/to/python-with-pyannote-metrics
```

Score oracle-word cpWER, or add `--asr-words` for a timestamped shared-ASR JSON
file:

```bash
yarn score:cpwer \
  --diarization /path/to/diarization.json \
  --meeting ES2004a \
  --words-root /path/to/ami-annotations/words
```

## Direct native parity

Run upstream Moonshine Swift 0.1.5 directly on macOS. The command downloads the
official model and diarization assets into Moonshine's cache, then emits lines,
word timestamps, and speaker spans as JSON:

```bash
yarn benchmark:moonshine:native small /path/to/audio.wav > moonshine.json
```

Run upstream `sherpa-onnx==1.13.0` Python directly with the same ONNX files used
by the app:

```bash
python apps/sherpa-voice/scripts/diarization-sherpa-python.py \
  --wav /path/to/audio.wav \
  --models-dir /path/to/sherpa-diarization-models \
  --cases-json /path/to/cases.json \
  --out sherpa-python.json
```

For FluidAudio, pin v0.15.6 and use its original Swift CLI:

```bash
git clone --branch v0.15.6 --depth 1 \
  https://github.com/FluidInference/FluidAudio.git /tmp/FluidAudio
swift run -c release --package-path /tmp/FluidAudio fluidaudiocli \
  process /path/to/audio.wav --mode offline --output fluid.json
```

## Evidence limits

- The iOS lane uses a simulator on the M5 Max. It validates the iOS code path
  and exact output parity, not physical-device performance.
- The independent full-meeting Android comparison currently contains one of
  the 16 official AMI test meetings. The full split is the next confidence
  step.
- AMI is meeting speech. Add VoxConverse before generalizing the result to
  interviews, television, or unconstrained recordings.
- The current WER/cpWER table has one full meeting. Run the complete AMI test
  split before setting a transcript-quality release gate.
- Debug-build memory numbers are recorded in raw reports but do not affect the
  quality ranking.

## Sources

- [FluidAudio 0.15.6](https://github.com/FluidInference/FluidAudio/tree/v0.15.6)
- [FluidAudio diarization benchmarks](https://github.com/FluidInference/FluidAudio/blob/v0.15.6/Documentation/Benchmarks.md#speaker-diarization)
- [Official AMI diarization setup](https://github.com/BUTSpeechFIT/AMI-diarization-setup/tree/2509d8933721023fab4def2618aabd5c28eb82e9)
- [Sherpa ONNX](https://github.com/k2-fsa/sherpa-onnx)
- [Moonshine 0.1.5](https://github.com/moonshine-ai/moonshine/releases/tag/v0.1.5)
