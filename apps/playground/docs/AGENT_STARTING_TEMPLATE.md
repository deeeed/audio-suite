# Agent Starting Template

All commands from `apps/playground/`.

## Step 1 — Verify app is running

```bash
node scripts/agentic/cdp-bridge.mjs list-devices
```

**0 devices:**

| Situation | Fix |
|-----------|-----|
| App installed | `scripts/agentic/start-metro.sh` |
| Android fresh install | `yarn android` |
| iOS fresh install | `IOS_SIMULATOR=playground-1 yarn ios` |
| Web | `node scripts/agentic/web-browser.mjs launch & && scripts/agentic/start-metro.sh` |
| Android physical | `adb devices` → `adb disconnect <wifi-ip>:5555` → `start-metro.sh` → deep link: `adb shell am start -a android.intent.action.VIEW -d "exp+audioplayground-development://expo-development-client/?url=http://<LAN_IP>:7365"` |
| iOS physical | `start-metro.sh` → `xcrun devicectl device process launch --device <UDID> --terminate-existing --payload-url "exp+audioplayground-development://expo-development-client/?url=http%3A%2F%2F<LAN_IP>%3A7365" <bundle-id>` |

Physical devices: always use Mac LAN IP (`ipconfig getifaddr en0`), never `localhost`.

Preferred iOS simulator slot:

- `playground-1`
- This should stay aligned with the Farmslot pool entry for `macwork-audiolab-1`.
- The preflight flow auto-creates the configured simulator if missing, but the
  farm-managed slot name remains the source of truth.

## Step 2 — Feedback channels

| Channel | Use when | Command |
|---------|----------|---------|
| JS eval | React bugs, state inspection | `app-state.sh eval "..."` |
| Native logs | Kotlin/Swift crashes | `native-logs.sh android\|ios` |
| Screenshots | UI layout, visual check | `screenshot.sh <label>` |
| State poll | Recording in progress | `app-state.sh state` |
| Press/scroll | UI interaction by testID | `app-state.sh press <id>` / `scroll --test-id <id>` |

## Step 3 — Baseline

```bash
scripts/agentic/app-navigate.sh "/(tabs)/record"
scripts/agentic/screenshot.sh baseline
```

## Step 4 — Implement

Read file before editing. Minimal diff. After each edit: `scripts/agentic/reload-metro.sh`

## Step 5 — Validate

```bash
# Recording — fire-and-store ONLY. A bare eval held open while audio starts
# flowing crashes the app (#436, Hermes SIGSEGV). Schedule the work so the eval
# returns first, stash results in a global, poll separately:
scripts/agentic/app-state.sh eval "(() => { globalThis.__V = {}; setTimeout(async () => { try { await __AGENTIC__.startRecording({ sampleRate: 44100, channels: 1 }); await new Promise(r => setTimeout(r, 3000)); const s = await __AGENTIC__.stopRecording(); globalThis.__V = { uri: s.fileUri, size: s.size, dur: s.durationMs } } catch (e) { globalThis.__V = { err: String(e) } } }, 1500); return 'scheduled' })()"
sleep 10
scripts/agentic/app-state.sh state
scripts/agentic/app-state.sh eval "JSON.stringify(globalThis.__V)"

# UI interaction
scripts/agentic/app-state.sh press start-recording-button   # → { ok: true }
scripts/agentic/app-state.sh scroll --test-id files-list --offset 300
sleep 1 && scripts/agentic/screenshot.sh post-change

# Native (if native code touched)
scripts/agentic/native-logs.sh android   # look for ERROR / Exception
```

## Step 6 — Type-check

```bash
yarn workspace @siteed/<pkg> build   # single package (~1.5s)
yarn typecheck && yarn lint:fix      # cross-package (slow)
```

## Step 7 — Done criteria

- [ ] Works on ≥1 platform
- [ ] No JS errors in CDP output
- [ ] No native ERRORs in `native-logs` (if native touched)
- [ ] Screenshot confirms expected UI
- [ ] TypeScript / lint clean

## Ask before proceeding when

- Requirements are ambiguous
- Protected file needs changing (`scripts/agentic/`, `.detoxrc.js`, root `/index.js`)
- Native build required (pod install / gradle sync)
- Scope expands beyond original request
