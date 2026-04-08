# Follow-up Prompt: word timestamps + progress fidelity in moonshine.rn

You are working in:
- `/Users/deeeed/dev/audiolab/packages/moonshine.rn`

## Context
EchoBridge consumer validation now proves:
- offline Moonshine transcription works end-to-end
- progress UI is surfaced in the app
- real word timestamps can be returned in practice on the current beta path

However, the consumer app should not be the primary place where we discover whether:
- word timestamps are actually supported reliably
- progress is granular or only coarse (`0 -> 100`)

Those behaviors must be validated at the library level in `moonshine.rn`.

## What should be owned by moonshine.rn

### 1. Word timestamps
Validate package-level behavior for offline file transcription:
- when `wordTimestamps` is enabled, does `transcribeWithoutStreaming(...)` return `line.words`?
- does it work consistently on:
  - iOS
  - Android
  - Web (where applicable)
- are required model artifacts downloaded/packaged automatically?
- if the feature requires special decoder/alignment assets, make that explicit in the package logic

### 2. Progress fidelity
Validate package-level progress behavior for offline file transcription:
- does the library emit intermediate progress updates, or just start/end state?
- is the sequence monotonic?
- does it represent meaningful phases such as:
  - model preparation
  - audio extraction / preprocessing
  - transcription inference
  - finalization

The consumer app should only need to display progress, not reverse-engineer whether the library emits meaningful progress.

## Required follow-up work

### A. Add package-level validation for offline file transcription
Use a real file transcription harness in this package and capture:
- whether word timestamps are present
- whether progress callback/events are emitted
- how many progress updates occur
- the exact progress sequence over time

### B. Characterize progress behavior explicitly
Produce a clear answer for each platform:
- iOS: granular or coarse?
- Android: granular or coarse?
- Web: granular or coarse?

If coarse, decide whether to improve it in the library itself instead of faking progress in consumer apps.

### C. Keep behavior explicit in docs or release notes
Document whether offline file transcription currently provides:
- real word timestamps
- granular progress events
- platform-specific caveats

## Definition of done
- package-level validation exists for word timestamps and progress behavior
- a real offline file transcription proves whether words are present
- a real offline file transcription proves whether progress is granular or coarse
- any required model artifacts are handled in-package
- consumer apps do not need to guess whether timings/progress are trustworthy
