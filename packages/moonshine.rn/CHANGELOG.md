# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.3-beta.0] - 2026-05-08
### Changed
- Keep the public npm tarball small by excluding heavyweight iOS xcframework and Android AAR binaries.
- Resolve Android native bits dynamically from Maven by default while preserving local source-AAR overrides.
- Prepare iOS native artifacts dynamically during CocoaPods install/build with visible download progress and optional checksum pinning.

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

[unreleased]: https://github.com/deeeed/audiolab/compare/@siteed/moonshine.rn@0.3.3-beta.0...HEAD
[0.3.3-beta.0]: https://github.com/deeeed/audiolab/compare/@siteed/moonshine.rn@0.3.2...@siteed/moonshine.rn@0.3.3-beta.0
[0.3.2]: https://github.com/deeeed/audiolab/compare/@siteed/moonshine.rn@0.3.1...@siteed/moonshine.rn@0.3.2
[0.3.1]: https://github.com/deeeed/audiolab/compare/@siteed/moonshine.rn@0.3.0...@siteed/moonshine.rn@0.3.1
[0.3.0]: https://github.com/deeeed/audiolab/releases/tag/@siteed/moonshine.rn@0.3.0
