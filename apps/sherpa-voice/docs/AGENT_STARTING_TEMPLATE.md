# Agentic Validation — sherpa-voice

Step-by-step workflow for using the CDP bridge to validate native sherpa-onnx features on-device.

## Prerequisites

- Metro running on port 7500: `yarn start` in `apps/sherpa-voice`
- App installed and connected (Android via USB + ADB, or iOS simulator booted)
- At least one sherpa-onnx model downloaded in the app

## Step 1: Verify Device Connection

```bash
cd apps/sherpa-voice
node scripts/agentic/cdp-bridge.mjs list-devices
```

Expected output: list of connected devices with `wsUrl` and `platform`.

## Step 2: Check App State

```bash
scripts/agentic/app-state.sh route     # Current screen
scripts/agentic/app-state.sh state     # Model / route state
```

## Step 3: Test Native Module — System Info

```bash
scripts/agentic/app-state.sh eval "__AGENTIC__.testSystemInfo()"
sleep 3
scripts/agentic/app-state.sh eval "__AGENTIC__.getLastResult()"
```

Expected: `{ op: 'systemInfo', status: 'success', result: { architecture: {...}, memory: {...}, ... } }`

## Step 4: Validate Library Load

```bash
scripts/agentic/app-state.sh eval "__AGENTIC__.testValidateLib()"
sleep 2
scripts/agentic/app-state.sh eval "__AGENTIC__.getLastResult()"
```

Expected: `{ op: 'validateLib', status: 'success', result: { loaded: true, status: '...' } }`

## Step 5: Test TTS (requires TTS model loaded in app)

```bash
# First navigate to TTS feature screen and load a model via the UI
scripts/agentic/app-navigate.sh "/features/tts"

# Then test generation
scripts/agentic/app-state.sh eval "__AGENTIC__.testTTS('Hello from the agentic bridge.')"
sleep 5
scripts/agentic/app-state.sh eval "__AGENTIC__.getLastResult()"
```

Expected: `{ op: 'tts', status: 'success', result: { filePath: '...', success: true, ... } }`

## Step 6: Take a Screenshot

```bash
scripts/agentic/screenshot.sh tts-test
```

## Step 7: Check Native Logs

```bash
scripts/agentic/native-logs.sh android        # Android (dump)
scripts/agentic/native-logs.sh android follow  # Android (follow)
scripts/agentic/native-logs.sh ios             # iOS simulator
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `WATCHER_PORT` | 7500 | Metro / CDP websocket port |
| `ANDROID_DEVICE` | (none) | ADB serial for target Android device |
| `IOS_SIMULATOR` | (booted) | iOS simulator name |

## Troubleshooting

**No devices found**: Make sure Metro is running on port 7500 (`yarn start`) and the dev client is open.

**`__AGENTIC__` not found**: Ensure the app is running in dev mode (`__DEV__ === true`). Check that `_layout.tsx` imports `agentic-bridge`.

**TTS/ASR fails with "not initialized"**: Load a model in the app UI first before running test commands.

**Android connectivity**: If using physical device, run `adb reverse tcp:7500 tcp:7500` after connecting.

**Real Android device shows Expo "Unable to load script" / `8081`**:
That screen is often misleading. The recurring root causes are a stale Metro instance for the wrong `APP_VARIANT`, the wrong installed package, or stale USB port forwarding.

Check the active Metro identity first:

```bash
tail -n 30 .agent/metro.log
```

Expected for the standard agentic path:

- `App Variant: development`
- `App Identifier: net.siteed.sherpavoice.development`

Recovery sequence:

```bash
APP_ROOT=$(pwd) bash scripts/agentic/stop-metro.sh
APP_VARIANT=development APP_ROOT=$(pwd) bash scripts/agentic/start-metro.sh
APP_VARIANT=development bash scripts/sync-android-dev-config.sh
yarn android:doctor
adb -s <serial> reverse --remove-all
adb -s <serial> reverse tcp:7500 tcp:7500
adb -s <serial> reverse tcp:8081 tcp:7500
adb -s <serial> shell am force-stop net.siteed.sherpavoice.development
adb -s <serial> shell am start -a android.intent.action.VIEW -d "exp+sherpa-voice-development://expo-development-client/?url=http%3A%2F%2Flocalhost%3A7500"
```

If that still fails, confirm the top activity belongs to the package you intended to validate:

```bash
adb -s <serial> shell pm list packages | rg 'net\\.siteed\\.sherpavoice'
adb -s <serial> shell dumpsys activity activities | sed -n '1,120p'
```

If `logcat` reports `ReconnectingWebSocket` to `127.0.0.1:7500` or `Unable to load script`,
the usual cause is a development APK built from stale production-generated Android config.
