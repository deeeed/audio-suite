---
id: getting-started
title: Getting Started with Audio Libraries
sidebar_label: Getting Started
---

# Getting Started with Audio Libraries

## 1. Prerequisites

- Node.js 18+
- Expo CLI (`npx expo`)
- Android Studio with an Android emulator or physical device (Android is the primary target)
- Xcode 15+ (macOS only; iOS sherpa-onnx.rn support is not yet available)

## 2. Create the project

```bash
npx create-expo-app@latest my-audio-app --template blank-typescript
cd my-audio-app
```

**Required:** Use the `node-modules` linker if you're on Yarn Berry (v2+). Create `.yarnrc.yml`:

```yaml
nodeLinker: node-modules
```

Then install and update the entrypoint:

```bash
yarn install
```

Replace `index.ts` with:

```ts
import 'expo-router/entry';
```

Create `metro.config.js`:

```js
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = config;
```

## 3. Install and configure @siteed/audio-studio

```bash
yarn add @siteed/audio-studio@3.0.2
yarn add expo-router expo-constants expo-linking react-native-safe-area-context react-native-screens react-dom
```

> Do **not** add `expo-permissions` — it is deprecated and incompatible with SDK 50+. Use `AudioStudioModule.requestPermissionsAsync()` directly.

Add the plugin to `app.json`:

```json
{
  "expo": {
    "name": "My Audio App",
    "slug": "my-audio-app",
    "scheme": "myaudioapp",
    "plugins": [
      "expo-router",
      "@siteed/audio-studio"
    ],
    "ios": {
      "bundleIdentifier": "com.example.myaudioapp",
      "infoPlist": {
        "NSMicrophoneUsageDescription": "Required for audio recording"
      }
    },
    "android": {
      "package": "com.example.myaudioapp",
      "permissions": [
        "android.permission.RECORD_AUDIO",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.READ_EXTERNAL_STORAGE"
      ]
    }
  }
}
```

**Recording screen** (`app/(tabs)/index.tsx`):

```tsx
import { AudioStudioModule, useAudioRecorder } from '@siteed/audio-studio';
import type { AudioRecording } from '@siteed/audio-studio';
import { useEffect, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

export default function RecordScreen() {
  const { startRecording, stopRecording, isRecording, durationMs } =
    useAudioRecorder();
  const [result, setResult] = useState<AudioRecording | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    AudioStudioModule.requestPermissionsAsync()
      .then((status: { granted: boolean }) => setPermissionGranted(status.granted))
      .catch((e: Error) => setError(e.message));
  }, []);

  const handleToggleRecording = async () => {
    try {
      setError(null);
      if (isRecording) {
        setResult(await stopRecording());
      } else {
        setResult(null);
        await startRecording({ sampleRate: 16000, channels: 1 });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Audio Recording</Text>
      {!permissionGranted && <Text style={styles.warn}>Microphone permission not granted.</Text>}
      {isRecording && <Text style={styles.info}>Recording: {(durationMs / 1000).toFixed(1)}s</Text>}
      {permissionGranted && (
        <Button
          title={isRecording ? 'Stop Recording' : 'Start Recording'}
          onPress={handleToggleRecording}
          color={isRecording ? '#c00' : '#007aff'}
        />
      )}
      {result && (
        <View style={styles.result}>
          <Text>URI: {result.fileUri}</Text>
          <Text>Duration: {(result.durationMs / 1000).toFixed(2)}s</Text>
          <Text>Size: {(result.size / 1024).toFixed(1)} KB</Text>
          <Button title="Clear" onPress={() => setResult(null)} />
        </View>
      )}
      {error && <Text style={styles.warn}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 60, backgroundColor: '#fff', gap: 16 },
  title: { fontSize: 24, fontWeight: 'bold' },
  warn: { color: '#c00' },
  info: { fontSize: 18, color: '#007aff' },
  result: { gap: 8 },
});
```

Prebuild and run:

```bash
yarn expo prebuild --platform android
cd android && ./gradlew :app:installDebug
```

## 4. Install and configure @siteed/sherpa-onnx.rn

> For native setup details and platform caveats, see the sherpa-onnx.rn README.

```bash
yarn add @siteed/sherpa-onnx.rn expo-file-system
```

No additional `app.json` plugin entry needed — auto-linking handles it.

**Important model choice:** Use `sherpa-onnx-whisper-tiny.en` (~40 MB) for offline `recognizeFromFile()`. The streaming zipformer models are **incompatible** with the offline recognizer API (different tensor dimensions). See Common Pitfalls.

**STT screen** (`app/(tabs)/stt.tsx`):

```tsx
import SherpaOnnx from '@siteed/sherpa-onnx.rn';
import type { AsrModelConfig } from '@siteed/sherpa-onnx.rn';
import { useAudioRecorder } from '@siteed/audio-studio';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useState } from 'react';
import { Button, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

const MODEL_NAME = 'sherpa-onnx-whisper-tiny.en';
const MODEL_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/' +
  MODEL_NAME + '.tar.bz2';

function getModelDir() {
  return `${FileSystem.documentDirectory}models/${MODEL_NAME}/`;
}

export default function SttScreen() {
  const { startRecording, stopRecording, isRecording, durationMs } = useAudioRecorder();
  const [libraryStatus, setLibraryStatus] = useState('Checking...');
  const [modelReady, setModelReady] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    SherpaOnnx.validateLibraryLoaded()
      .then((r) => setLibraryStatus(r.loaded ? 'Loaded' : `Not loaded: ${r.status}`))
      .catch((e: Error) => setLibraryStatus(`Error: ${e.message}`));
    FileSystem.getInfoAsync(`${getModelDir()}tiny.en-tokens.txt`)
      .then((info) => setModelReady(info.exists));
  }, []);

  async function handleDownload() {
    try {
      setDownloading(true);
      const modelsDir = `${FileSystem.documentDirectory}models/`;
      await FileSystem.makeDirectoryAsync(modelsDir, { intermediates: true });
      const archivePath = `${modelsDir}${MODEL_NAME}.tar.bz2`;
      const dl = FileSystem.createDownloadResumable(MODEL_URL, archivePath, {}, (p) => {
        setDownloadProgress(p.totalBytesExpectedToWrite > 0
          ? p.totalBytesWritten / p.totalBytesExpectedToWrite : 0);
      });
      await dl.downloadAsync();
      const extraction = await SherpaOnnx.Archive.extractTarBz2(archivePath, modelsDir);
      if (!extraction.success) throw new Error(`Extraction failed: ${extraction.message}`);
      await FileSystem.deleteAsync(archivePath, { idempotent: true });
      setModelReady(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  async function handleRecord() {
    try {
      setError(null);
      setTranscript(null);
      if (isRecording) {
        setProcessing(true);
        const recording = await stopRecording();
        const config: AsrModelConfig = {
          modelDir: getModelDir(),
          modelType: 'whisper',
          numThreads: 2,
          decodingMethod: 'greedy_search',
          streaming: false,
          modelFiles: {
            encoder: 'tiny.en-encoder.int8.onnx',
            decoder: 'tiny.en-decoder.int8.onnx',
            tokens: 'tiny.en-tokens.txt',
          },
        };
        await SherpaOnnx.ASR.initialize(config);
        const result = await SherpaOnnx.ASR.recognizeFromFile(recording.fileUri);
        await SherpaOnnx.ASR.release();
        setTranscript(result.text ?? '');
        setProcessing(false);
      } else {
        await startRecording({ sampleRate: 16000, channels: 1 });
      }
    } catch (e) {
      setError((e as Error).message);
      setProcessing(false);
    }
  }

  if (Platform.OS !== 'android') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Speech-to-Text</Text>
        <Text>STT is only available on Android in this beta version.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Speech-to-Text</Text>
      <Text>Library: {libraryStatus}</Text>
      {!modelReady && !downloading && (
        <Button title="Download Model (~40 MB)" onPress={handleDownload} />
      )}
      {downloading && <Text style={styles.info}>Downloading... {(downloadProgress * 100).toFixed(0)}%</Text>}
      {modelReady && !processing && (
        <Button
          title={isRecording ? `Stop & Transcribe (${(durationMs/1000).toFixed(1)}s)` : 'Start Recording'}
          onPress={handleRecord}
          color={isRecording ? '#c00' : '#007aff'}
        />
      )}
      {processing && <Text style={styles.info}>Processing...</Text>}
      {transcript !== null && (
        <View style={styles.result}>
          <Text style={styles.label}>Transcript</Text>
          <Text>{transcript || '(empty — no speech detected)'}</Text>
          <Button title="Clear" onPress={() => setTranscript(null)} />
        </View>
      )}
      {error && <Text style={styles.warn}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 60, backgroundColor: '#fff', gap: 16, flexGrow: 1 },
  title: { fontSize: 24, fontWeight: 'bold' },
  info: { fontSize: 16, color: '#007aff' },
  label: { fontWeight: '600' },
  result: { gap: 8 },
  warn: { color: '#c00' },
});
```

## 5. Common pitfalls

- **Yarn Berry PnP breaks Expo config plugins**: Add `.yarnrc.yml` with `nodeLinker: node-modules`.
- **`expo-permissions` incompatible with SDK 55**: Remove it; use `AudioStudioModule.requestPermissionsAsync()`.
- **`documentDirectory` not found**: Import from `expo-file-system/legacy`, not `expo-file-system`.
- **Web export WASM URL**: By default the library loads the WASM glue from jsDelivr CDN. To self-host, call `setMelSpectrogramWasmUrl('/path/to/mel-spectrogram.js')` (imported from `@siteed/audio-studio`) before any mel-spectrogram or audio-features API call.
- **Streaming model incompatible with recognizeFromFile()**: Do not use `sherpa-onnx-streaming-zipformer-*` models with `streaming: false`. Use an offline model such as `sherpa-onnx-whisper-tiny.en`.
- **`expo-av` incompatible with Xcode 26 beta**: Remove it from `package.json` if present — it was deprecated and causes header errors on Xcode 26.

## 6. Next steps

- **@siteed/audio-studio full docs**: See the [README](https://github.com/deeeed/audiolab/tree/main/packages/audio-studio) for mel spectrogram, waveform streaming, dual-stream recording, and more.
- **@siteed/sherpa-onnx.rn README**: See the [package README](https://github.com/deeeed/audiolab/tree/main/packages/sherpa-onnx.rn) for TTS, VAD, speaker ID, keyword spotting, and other services.
