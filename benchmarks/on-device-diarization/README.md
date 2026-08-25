# Re-running the diarization benchmark

The benchmark contract is [`manifest.json`](./manifest.json). Change that file
when testing a new runtime, model, threshold, or dataset revision. Increment
`benchmarkVersion`, preserve the old result, and add a new dated result.

The current recommendation, evidence tables, and metric definitions are in
[`on-device-diarization-benchmark.md`](../../apps/sherpa-voice/docs/on-device-diarization-benchmark.md).

## One-time local setup

You need the AMI audio tree and manual word annotations. Audio paths follow:

```text
$AMI_AUDIO_ROOT/ES2004a/audio/ES2004a.Mix-Headset.wav
```

Benchmark CLIs accept paths under the repository and system temporary directory.
For datasets elsewhere, authorize their common parent explicitly:

```bash
export BENCHMARK_ALLOWED_ROOTS=/Volumes/c910ssd/datasets
```

Create the scorer environment:

```bash
python3 -m venv /tmp/audiolab-pyannote
/tmp/audiolab-pyannote/bin/python -m pip install \
  -r scripts/diarization-benchmark/requirements.txt
```

Check the local setup before a run:

```bash
AMI_AUDIO_ROOT=/path/to/amicorpus \
PYANNOTE_PYTHON=/tmp/audiolab-pyannote/bin/python \
yarn doctor:diarization-benchmark
```

## Fast parity run

Run the original FluidAudio library on macOS and the local iOS simulator:

```bash
AMI_AUDIO_ROOT=/path/to/amicorpus \
PYANNOTE_PYTHON=/tmp/audiolab-pyannote/bin/python \
yarn benchmark:diarization:macos

AMI_AUDIO_ROOT=/path/to/amicorpus \
PYANNOTE_PYTHON=/tmp/audiolab-pyannote/bin/python \
yarn benchmark:diarization:ios-simulator
```

Both must return the same 95 ES2004a segments and the same DER/JER. Timing only
compares runs on the same host. The simulator is not a physical-iPhone speed
proxy.

Run upstream Sherpa Python:

```bash
AMI_AUDIO_ROOT=/path/to/amicorpus \
SHERPA_PYTHON=/path/to/python-with-sherpa-onnx-1.13.0 \
PYANNOTE_PYTHON=/tmp/audiolab-pyannote/bin/python \
yarn benchmark:diarization:sherpa-python
```

Compare its raw segments with the Pixel report. The current known-count and
automatic-count cases are byte-for-byte identical across Python and Android.

## Full quality gate

Use the 16 official AMI test meetings for automatic-count recommendations:

```bash
BENCHMARK_SCOPE=full \
AMI_AUDIO_ROOT=/path/to/amicorpus \
PYANNOTE_PYTHON=/tmp/audiolab-pyannote/bin/python \
yarn benchmark:diarization:macos
```

The manifest gate requires all 16 meetings, macro DER at most 15%, macro JER at
most 25%, and exact speaker counts on at least 12 meetings. A known-count run is
an upper bound and cannot pass this gate.

## Transcript quality

Use one timestamped ASR result for every diarizer:

```bash
yarn score:cpwer \
  --diarization /path/to/report.json \
  --meeting ES2004a \
  --words-root /path/to/ami-annotations/words \
  --asr-words /path/to/shared-asr-words.json
```

Without `--asr-words`, the scorer assigns official words to predicted speakers.
That produces zero WER and oracle-word cpWER, which isolates attribution.
The exact bitmask scorer supports at most 20 reference speakers and is intended
for meeting-sized speaker sets such as AMI.

## Python Pyannote reference

Community-1 is gated. Accept its Hugging Face terms and set `HF_TOKEN`. The
runner never writes the token into reports.

```bash
python -m pip install \
  -r scripts/diarization-benchmark/requirements-pyannote.txt
python apps/sherpa-voice/scripts/diarization-pyannote-python.py \
  --wav /path/to/ES2004a.Mix-Headset.wav \
  --device mps \
  --out pyannote-es2004a.json
```

Score it with the same scorer and compare quality before RTFx. A faster result
that misses the DER/JER tolerance is not efficient parity.

## Final check

```bash
yarn test:diarization-reference
yarn verify:diarization-benchmark
```

Raw logs and generated reports stay under `.agent/diarization-benchmark/`.
