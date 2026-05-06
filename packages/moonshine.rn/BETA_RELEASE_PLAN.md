# `@siteed/moonshine.rn` Beta Release Plan

This package is now at the point where the next high-value step is **beta
publication plus external-consumer validation** rather than more internal
playground-only work.

The goal of the beta is not just “publish something”. The goal is to prove
that a consumer **outside this monorepo** can:

1. install the package cleanly
2. follow the docs without tribal knowledge
3. build on iOS / Android / web as applicable
4. use the main API surface successfully
5. report any friction before a stable release

## Recommended versioning

Use a prerelease tag instead of publishing straight to `latest`.

Recommended first beta:

- `0.2.0-beta.0`

That gives room to iterate on docs/setup/API ergonomics without implying
stability yet.

## Package-size risk to validate before publish

The package payload must stay under npm's practical upload limits while still
being usable for real consumers.

The original beta candidate was too large because it shipped too many heavy
native/web artifacts at once:

- iOS xcframework slices
- Android AAR
- bundled web model assets

The first publishable beta was achieved by trimming repo-only / duplicate
payloads, but package size should still be watched closely in every release.

At minimum, run the native release validation on every beta tarball:

```bash
yarn validate:native-release
```

This checks that the packaged iOS xcframework contains device and simulator slices, confirms Android published consumers use the Maven fallback instead of a missing local AAR, and verifies `npm pack --json --dry-run` includes/excludes the expected native artifacts. Record packed size, unpacked size, largest files, and whether each large artifact is intentionally included.

## Beta publish flow

From `packages/moonshine.rn/`:

```bash
yarn release:beta:preflight
```

This runs:

- `yarn typecheck`
- `yarn test`
- `npm pack --json --dry-run`

Then publish under the beta tag:

```bash
npm publish --tag beta
```

If you want to inspect the final tarball contents first:

```bash
npm pack --json
```

## External consumer validation target

Use:

- `~/dev/demo-audiolab`

This repo is valuable because it behaves like a clean consumer app rather than
the internal playground monorepo.

## What must be validated externally

### Install/setup

- package install works from npm beta
- React Native / Expo autolinking behaves as documented
- Yarn 4 / Yarn Berry consumer setup is documented clearly enough
- CocoaPods / Android build setup is understandable
- web setup is understandable

### Main package flows

- file transcription
- live transcription startup
- intent recognition
- basic web initialization

### Friction audit

Record every confusing step, including:

- undocumented environment assumptions
- missing native setup notes
- asset-path confusion
- platform caveats that are only implied today
- APIs that feel too internal or too monorepo-specific
- package-size concerns that would make upgrades unrealistic for clients

## Exit criteria before stable

Do not cut a stable release until the external app validates:

- install/setup is reproducible
- at least one transcription path works from consumer code
- at least one intent-recognition path works from consumer code
- docs are sufficient without local repo knowledge
- no critical platform surprises remain

## Suggested follow-up after beta validation

- tighten README installation section based on external feedback
- add one minimal example snippet per platform
- simplify any setup that repeatedly trips the external client
- keep `npm pack --json --dry-run` as a hard release gate
- cut `0.2.0-beta.1`, `beta.2`, etc. until the flow is clean enough for stable
