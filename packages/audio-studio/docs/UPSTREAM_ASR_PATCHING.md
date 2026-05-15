# Upstream ASR patching workflow

This repo carries React Native integration fixes for long compressed-audio
transcription. Keep upstream clones beside `audiolab` so fixes can be developed
against the latest upstream branches before they are vendored or patched here.

## Local upstream checkouts

Expected local layout:

```text
/Volumes/c910ssd/dev/audiolab       # React Native integration + validation app
/Volumes/c910ssd/dev/moonshine      # upstream moonshine checkout
/Volumes/c910ssd/dev/sherpa-onnx    # upstream sherpa-onnx checkout/fork
```

Recommended remotes:

```bash
# Moonshine
cd /Volumes/c910ssd/dev/moonshine
git remote -v
# origin   <your fork, if available>
# upstream https://github.com/moonshine-ai/moonshine.git

git fetch --all --prune --tags
git checkout -B rn-long-streaming-memory-fix upstream/main

# Sherpa ONNX
cd /Volumes/c910ssd/dev/sherpa-onnx
git remote -v
# origin   <your fork>
# upstream https://github.com/k2-fsa/sherpa-onnx.git

git fetch --all --prune --tags
git checkout -B rn-long-audio-asr-validation upstream/master
```

Use `GIT_LFS_SKIP_SMUDGE=1` when cloning if model artifacts or test binaries are
not needed for the patch. Fetch LFS objects only for the specific upstream test
that requires them.

## Moonshine PR scope

The current React Native validation found a long-streaming memory issue in
Moonshine's VAD path. The fix keeps completed VAD audio only when
`return_audio_data=true`; React Native defaults that option off unless
`includeAudioData` is explicitly requested. The audiolab vendored patch is:

```text
packages/moonshine.rn/patches/LongStreamingMemory.patch
```

The latest-upstream PR patch prepared from the current upstream `main` branch is:

```text
.agent/upstream-pr/moonshine-main-long-streaming-memory.patch
.agent/upstream-pr/moonshine-main-pr-draft.md
```

Opened upstream draft PR:

```text
https://github.com/moonshine-ai/moonshine/pull/175
```

Before opening the PR, verify it against the upstream checkout:

```bash
cd /Volumes/c910ssd/dev/moonshine
git fetch upstream main
git checkout -B rn-long-streaming-memory-fix upstream/main
git apply --check /Volumes/c910ssd/dev/audiolab/.agent/upstream-pr/moonshine-main-long-streaming-memory.patch
git apply /Volumes/c910ssd/dev/audiolab/.agent/upstream-pr/moonshine-main-long-streaming-memory.patch
```

The PR explanation should link back to the React Native validation evidence in
`audiolab`, especially the Android and iOS 100-minute Opus runs, to show the
change is driven by a reproducible integration and not an untested drive-by
patch.

## Sherpa ONNX PR scope

Sherpa is used as the configurable benchmark path for higher-quality ASR models
such as Qwen3. Current audiolab validation intentionally keeps the model config
externalized:

```text
packages/audio-studio/scripts/qwen3-asr-playground-config.json
packages/audio-studio/scripts/validate-stream-long.mjs
```

The likely upstream Sherpa/RN improvements to prepare as separate PRs are:

1. Add a typed-array/JSI-friendly RN `acceptWaveform` path so long streaming
   benchmarks do not require converting every Float32 chunk to a JS `number[]`.
2. Document or expose memory-safe segmented offline recognition patterns for
   very long files, including explicit release/reinitialize behavior between
   segments for large models.
3. Keep model selection configurable; do not hardcode Zipformer when the
   validation target is a stronger model such as Qwen3.

Prepare Sherpa patches from `/Volumes/c910ssd/dev/sherpa-onnx` on a branch based
on `upstream/master`, then mirror the validation command and evidence path in the
PR body.

## Validation evidence to attach

Long-audio evidence is stored under:

```text
/Volumes/c910ssd/dev/audiolab/.agent/validation-logs/
```

Minimum evidence before filing upstream PRs:

- Android full Moonshine 100-minute Opus success log: `.agent/validation-logs/validate-stream-long-android-moonshine-full-vadfix-20260514T062106Z.jsonl`.
- iOS full Moonshine 100-minute Opus success log: `.agent/validation-logs/validate-stream-long-ios-moonshine-full-vadfix-20260514T085020Z.jsonl`.
- `git diff --check` and relevant workspace typechecks.
- Patch application check against the latest upstream branch.
- If touching Sherpa, Qwen3 segmented benchmark logs with the exact config file
  used.
