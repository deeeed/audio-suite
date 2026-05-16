# Physical iOS long diarization validation runbook

_Last updated: 2026-05-15_

This runbook records the physical-iOS gate for the long diarization goal: prove the 60-minute, 2-speaker fixture on a physical iPhone using 5-minute native windows plus global speaker re-identification.

## Current status

Physical iOS validation is complete via a temporary local signing workaround. The existing Xcode-managed profile for `net.siteed.audioplayground.development` was used to install/launch `SherpaVoiceDev.app` on iPhone 12. This proves the native diarization path on physical iOS, but normal `net.siteed.sherpavoice.development` provisioning should still be added for future clean installs.

Current evidence:

- iOS simulator 60m global re-ID is validated: DER `5.89%`, JER `7.35%`.
- Android Pixel 6a physical 60m global re-ID is validated: DER `6.15%`, JER `7.80%`.
- iPhone 12 physical 60m global re-ID is validated: DER `5.89%`, JER `7.35%`.
- `SherpaVoiceDev` compiles for generic `iphoneos` with `CODE_SIGNING_ALLOWED=NO`.
- `diarization:verify-long-goal` passes with `ok: true`.

## Device and target

| Item | Value |
| --- | --- |
| Device | iPhone 12 physical |
| UDID | `00008101-001348AC1490801E` |
| Target bundle ID | `net.siteed.sherpavoice.development` |
| Temporary validated bundle ID | `net.siteed.audioplayground.development` |
| EAS project | `5360ada5-3236-4b98-8b54-4d680e9267c6` |
| Apple team | `G5DZE7G2V4` |

## Normal future commands after SherpaVoiceDev provisioning is available

Run from repo root unless noted.

```bash
cd apps/sherpa-voice

# 0. Optional one-command blocker/status check.
yarn ios:signing:doctor

# 1. Interactive provisioning; complete Apple 2FA when prompted.
yarn ios:credentials

# 2. Build signed dev client remotely, download IPA, extract Payload/*.app,
#    and install on the connected iPhone.
yarn ios:device:eas-build-install:dry-run
yarn ios:device:eas-build-install

# 3. Launch the installed signed dev client without local signing.
yarn ios:device:launch

# 4. Validate local prerequisites, then run the 60-minute benchmark.
yarn diarization:ios:physical:dry-run
yarn diarization:ios:physical

# 5. Final completion gate.
yarn diarization:verify-long-goal
```

## Expected artifacts

The physical iOS runner writes:

```text
.agent/validation-logs/diarization/perps-60m-ios-physical-iphone12-windowed-global-reid-native-eres2net-fullseg.json
.agent/validation-logs/diarization/perps-60m-ios-physical-iphone12-windowed-global-reid-native-eres2net-fullseg-pyannote-score.json
```

It also appends/replaces the iPhone 12 row in:

```text
.agent/validation-logs/diarization/native-long-window-validation-summary.json
```

The final verifier requires:

- Android Pixel 6a physical 60m row exists.
- iPhone 12 physical 60m row exists.
- Raw and pyannote score artifacts exist.
- 12 windows of 5 minutes.
- 2 speakers.
- DER <= 10% and JER <= 12%.
- No remaining `blockedValidation` rows.

## If EAS build/install fails before queueing

This section is only needed for future clean `net.siteed.sherpavoice.development` installs. If `yarn ios:device:eas-build-install` reports missing internal-distribution credentials, rerun:

```bash
yarn ios:credentials
```

and complete Apple 2FA. The build/install helper intentionally fails before queueing a build when credentials are missing.
