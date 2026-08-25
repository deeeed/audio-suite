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

Before each release, check the published versions and increment the current
prerelease:

```bash
npm view @siteed/moonshine.rn versions --json
npm view @siteed/moonshine.rn dist-tags --json
```

Keep `latest` on the last stable version until the exit criteria below pass.

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

This checks that the public npm tarball excludes heavyweight iOS and Android binaries, confirms both platforms download checksum-pinned release assets, and verifies `npm pack --json --dry-run` includes the installer scripts. When the isolated Android AAR exists locally, the validator checks every ABI for the private `libmoonshine_onnxruntime.so` SONAME and verifies that both Moonshine libraries depend on it instead of `libonnxruntime.so`. Record packed size, unpacked size, largest files, and whether each large artifact is intentionally included.

## Beta publish flow

First merge a release PR that updates `package.json` and moves the relevant
changelog entries out of `Unreleased`. From `packages/moonshine.rn/`, run:

```bash
yarn release:beta:preflight
```

This runs:

- `yarn typecheck`
- `yarn test`
- `npm pack --json --dry-run`

After the release PR merges:

1. Create the `@siteed/moonshine.rn@<version>` GitHub prerelease at the merge
   commit.
2. Upload `Moonshine-Android-isolated.aar` and
   `Moonshine.xcframework.zip`. Reuse an earlier asset only when its SHA-256
   matches the value pinned in `package.json`; do not rebuild unchanged assets.
3. Run the remote artifact checks. They must fail before upload and pass after:

```bash
yarn validate:android-release-artifact
yarn validate:ios-release-artifact
```

4. Publish under the beta tag:

```bash
npm publish --tag beta
```

`prepublishOnly` reruns the package and remote artifact gates, so publishing is
blocked until both assets exist under the new release tag with the pinned
checksums.

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
- keep `yarn validate:native-release` / `npm pack --json` as hard release gates
- cut `0.2.0-beta.1`, `beta.2`, etc. until the flow is clean enough for stable
