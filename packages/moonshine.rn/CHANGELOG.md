# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking / Migration

- Native per-line audio retention now follows the public `includeAudioData`
  option. If you depended on implicit upstream per-line PCM data, pass
  `includeAudioData: true`; otherwise long streams default to text/progress
  retention only.

### Changed

- Accept `Float32Array` as a Moonshine PCM input type at the JS API boundary. Legacy React Native native-module calls still materialize arrays internally, so long-stream callers should keep chunks bounded until a JSI/ArrayBuffer path is available.
- Align native `return_audio_data` retention with the public `includeAudioData`
  option on Android and iOS. RN now defaults native per-line PCM retention off,
  preventing long streaming sessions from keeping every VAD segment's samples
  when callers only need transcript text/progress.
- Avoid copying historical VAD segment PCM on every streaming update and release
  completed VAD segment samples after transcription when `return_audio_data=false`,
  so very long Moonshine streams retain only active-segment audio plus text
  transcript state unless callers explicitly request per-line audio.

## [0.3.3] - 2026-05-08

### Changed

- Promote the lightweight public install flow from beta to stable. Public npm installs stay thin while iOS resolves the xcframework from a checksum-pinned GitHub release asset and Android resolves native binaries through Maven by default.

## [0.3.3-beta.7] - 2026-05-08

### Added

- Add CocoaPods-driven iOS artifact preparation for public installs without shipping the xcframework in npm.
- Add Android Maven fallback for public installs while preserving source-AAR/custom-AAR overrides for development.
- Add release validators for the packed npm tarball contract, iOS release asset integrity, and optional Android AAR symbol inspection.
- Add fixture-based tests for the iOS artifact installer covering cache hit, cache miss, corrupt cache refetch, checksum mismatch, and missing cache-root failures.
- Add consumer README guidance for cross-platform setup, customization hooks, and web ORT/model asset configuration.

### Changed

- Keep the public npm tarball lightweight by excluding heavyweight iOS xcframework and Android AAR binaries.
- Cache downloaded iOS artifacts outside `node_modules` using version/checksum keys, with URL-hash fallback for unpinned artifacts.
- Verify pinned iOS artifact checksums both during consumer install and during the publish gate.
- Make CocoaPods artifact preparation use explicit package-root paths and POSIX-compatible shell conditionals.
- Prefer newer Android NDK `llvm-readelf` candidates during native release validation.
- Support `sha256sum` as a fallback when `shasum` is unavailable.

## [0.3.2] - 2026-05-06

### Added

- Native release validation via `yarn validate:native-release`, covering the packed npm tarball, required iOS xcframework device/simulator slices, Android Maven fallback expectations, headers, and package-size reporting.
- `yarn release:beta:preflight` now runs typecheck, tests, and native release validation so incomplete native artifacts are caught before publishing.

### Changed

- Updated the beta release plan to require native preflight validation and to document packed-size evidence for future releases.

## [0.3.1] - 2026-05-06

### Changed

- Published the stable `0.3.1` package and documented `AUDIOLAB_NPM_TOKEN`-based npm publishing credentials for the monorepo release flow.

## [0.3.0] - 2026-04-09

### Added

- Moonshine RN package with iOS, Android, and web transcription support, source-built native tooling, offline progress events, and word timestamp parity fixes.
- Beta release plan and external consumer validation checklist.

[unreleased]: https://github.com/deeeed/audiolab/compare/@siteed/moonshine.rn@0.3.3...HEAD
[0.3.3]: https://github.com/deeeed/audiolab/compare/@siteed/moonshine.rn@0.3.3-beta.7...@siteed/moonshine.rn@0.3.3
[0.3.3-beta.7]: https://github.com/deeeed/audiolab/compare/@siteed/moonshine.rn@0.3.2...@siteed/moonshine.rn@0.3.3-beta.7
[0.3.2]: https://github.com/deeeed/audiolab/compare/@siteed/moonshine.rn@0.3.1...@siteed/moonshine.rn@0.3.2
[0.3.1]: https://github.com/deeeed/audiolab/compare/@siteed/moonshine.rn@0.3.0...@siteed/moonshine.rn@0.3.1
[0.3.0]: https://github.com/deeeed/audiolab/releases/tag/@siteed/moonshine.rn@0.3.0
