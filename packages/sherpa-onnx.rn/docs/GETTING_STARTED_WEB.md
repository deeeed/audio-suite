# Getting Started: Web (External Consumers)

This guide is for apps that install `@siteed/sherpa-onnx.rn` from npm and want to use speech features in the browser. The WASM runtime can load from CDN with no copied files; model files still come from the `modelBaseUrl` you provide for the backend you initialize.

For self-hosting WASM and models, see [WEB.md](./WEB.md).

## Install

```bash
yarn add @siteed/sherpa-onnx.rn
# or
npm install @siteed/sherpa-onnx.rn
```

## 1. Load WASM at App Startup (Non-blocking)

Call `loadWasmModule()` fire-and-forget in your app entry point — **do not await it**. This fetches the ~12 MB WASM binary from jsDelivr CDN and compiles it in the background while your app renders immediately.

```typescript
// index.ts (or main entry point)
import { loadWasmModule, isSherpaOnnxReady } from '@siteed/sherpa-onnx.rn';
import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';
import App from './App';

if (Platform.OS === 'web') {
  // Fire-and-forget — UI renders immediately
  loadWasmModule({
    debug: true,
    onProgress: (event) => {
      // Phases: wasm-binary → runtime-init → module (×N) → ready
      console.log(`[WASM] ${event.phase} (${event.loaded}/${event.total})`);
    },
  }).then((loaded) => {
    console.log('WASM ready:', loaded);
  });
}

// Register immediately — no waiting for WASM
registerRootComponent(App);
```

The WASM runtime is served automatically from jsDelivr (matching your installed package version). No need to copy runtime files to `public/` unless you want self-hosting. If you do self-host, copy `node_modules/@siteed/sherpa-onnx.rn/wasm/` to your static directory and call `configureSherpaOnnx({ wasmBasePath: '/wasm/' })` before `loadWasmModule()`.

### Loading Indicator Component

Use `waitForReady()` to await WASM readiness in React components — no polling needed:

```typescript
import { waitForReady } from '@siteed/sherpa-onnx.rn';
import { useEffect, useState } from 'react';

function useSherpaReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    waitForReady().then((loaded) => setReady(loaded));
  }, []);
  return ready;
}
```

`waitForReady()` resolves immediately if WASM is already loaded, or waits for it to finish. You can also use `isSherpaOnnxReady()` for synchronous polling if preferred.

Services like `ASR.initialize()` internally await the WASM runtime via `loadCombinedWasm()`, so you don't need to gate on readiness before calling them — they will wait automatically.

## 2. Use ASR (Speech-to-Text)

`ASR.initialize()` internally waits for the WASM runtime to be ready, so you don't need to gate on `loadWasmModule()` completion.

### Streaming (online) — transducer models

```typescript
import { ASR } from '@siteed/sherpa-onnx.rn';

await ASR.initialize({
  modelDir: '/wasm/asr',
  modelType: 'zipformer2',
  streaming: true,
  modelBaseUrl: 'https://huggingface.co/deeeed/sherpa-voice-models/resolve/main/asr',
});

await ASR.createOnlineStream();

// Feed audio chunks (e.g. from microphone)
await ASR.acceptWaveform(16000, samples);
const result = await ASR.getResult();
console.log(result.text);

await ASR.release();
```

### Offline — whisper, paraformer, moonshine, Qwen3, etc.

```typescript
import { ASR } from '@siteed/sherpa-onnx.rn';

// Whisper example
await ASR.initialize({
  modelDir: '/wasm/asr-whisper',
  modelType: 'whisper',
  // streaming defaults to false for offline-only types
  modelBaseUrl: 'https://example.com/models/whisper-tiny',
  modelFiles: {
    encoder: 'tiny-encoder.onnx',
    decoder: 'tiny-decoder.onnx',
    tokens: 'tokens.txt',
  },
});

const result = await ASR.recognizeFromFile(fileUri);
console.log(result.text);

await ASR.release();
```

### Qwen3-ASR

```typescript
import { ASR } from '@siteed/sherpa-onnx.rn';

await ASR.initialize({
  modelDir: '/wasm/asr-qwen3',
  modelType: 'qwen3',
  streaming: false,
  modelBaseUrl:
    'https://huggingface.co/deeeed/sherpa-voice-models/resolve/main/asr-qwen3',
  modelFiles: {
    encoder: 'encoder.int8.onnx',
    decoder: 'decoder.int8.onnx',
    convFrontend: 'conv_frontend.onnx',
  },
  qwen3: {
    maxTotalLen: 512,
    maxNewTokens: 128,
  },
});

const result = await ASR.recognizeFromFile(fileUri);
console.log(result.text);
```

Qwen3 uses a `tokenizer/` directory instead of `tokens.txt`. By default the web loader fetches `vocab.json`, `merges.txt`, and `tokenizer_config.json` from that directory. Pass `qwen3.tokenizerFiles` only when your hosted tokenizer uses a different layout.

### Config fields

| Field | Description |
|-------|-------------|
| `modelDir` | Virtual FS path for model files (e.g. `/wasm/asr`) |
| `modelType` | Model architecture (see table below) |
| `streaming` | `true` for online/streaming, `false` or omit for offline |
| `modelBaseUrl` | Remote URL where model files are served |
| `modelFiles` | Custom file names (overrides defaults like `encoder.onnx`) |
| `decodingMethod` | `'greedy_search'` (default) or `'beam_search'` |
| `language` | Language hint for multilingual offline backends such as Whisper and SenseVoice |
| `qwen3` | Qwen3 generation options and web tokenizer file list |
| `onProgress` | Callback for download progress (web only) |

When `modelBaseUrl` is set, model files are fetched from that URL at init time and written to the Emscripten virtual filesystem. They are cached by the browser's HTTP cache.

## 3. Supported Model Types

### Online (streaming) models

These support real-time streaming via `ASR.createOnlineStream()`:

| `modelType` | Files needed |
|---|---|
| `transducer` / `zipformer` / `zipformer2` | encoder.onnx, decoder.onnx, joiner.onnx, tokens.txt |

### Offline (non-streaming) models

These process complete audio in one pass via `recognizeFromSamples()` / `recognizeFromFile()`:

| `modelType` | Files needed |
|---|---|
| `whisper` | encoder.onnx, decoder.onnx, tokens.txt |
| `moonshine` | preprocessor.onnx, encoder.onnx, uncached_decoder.onnx, cached_decoder.onnx, tokens.txt |
| `paraformer` | model.onnx, tokens.txt |
| `sense_voice` | model.onnx, tokens.txt |
| `fire_red_asr` | encoder.onnx, decoder.onnx, tokens.txt |
| `dolphin` | model.onnx, tokens.txt |
| `qwen3` | conv_frontend.onnx, encoder.int8.onnx, decoder.int8.onnx, tokenizer/ |
| Specialized upstream backends | Check the upstream model layout; some large variants require sidecar data files |
| `nemo_ctc` / `nemo_transducer` | model.onnx, tokens.txt |
| `tdnn` / `telespeech_ctc` / `wenet_ctc` / `zipformer2_ctc` | model.onnx, tokens.txt |
| `transducer` variants (with `streaming: false`) | encoder.onnx, decoder.onnx, joiner.onnx, tokens.txt |

### Model sources

**sherpa-onnx model zoo** (full catalog):
- https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models
- Host model files on any CDN or static server and pass the URL as `modelBaseUrl`

### Model file layout

Your `modelBaseUrl` must serve the files listed for your model type. For example, a transducer model:
```
<modelBaseUrl>/
  encoder.onnx
  decoder.onnx
  joiner.onnx
  tokens.txt
```

Use `modelFiles` to override default file names if your model uses different names:
```typescript
modelFiles: {
  encoder: 'encoder-int8.onnx',
  decoder: 'decoder-int8.onnx',
}
```

For Qwen3 and other directory-based models, keep nested paths intact:

```
<modelBaseUrl>/
  conv_frontend.onnx
  encoder.int8.onnx
  decoder.int8.onnx
  tokenizer/
    vocab.json
    merges.txt
    tokenizer_config.json
```

Specialized large-model backends can require external sidecar files next to their ONNX files. Check the upstream model layout before hosting them for web.

## Troubleshooting

**Blank screen on startup**: If you `await loadWasmModule()` before `registerRootComponent()`, the page will be blank until WASM finishes loading. Use the fire-and-forget pattern shown above instead.

**"Loading WASM..." stays for a long time**: The ~12 MB WASM binary takes time to download and compile on first visit. Subsequent visits use the browser cache. Use the `onProgress` callback to show progress in your UI.

**ASR.initialize() hangs**: Check browser console for 404 errors on model files. Verify your `modelBaseUrl` serves the required files for your model type.

**Large offline ASR models are slow on first run**: Some offline models download hundreds of MB or more depending on the variant. Use `onProgress`, host with range/cache-friendly headers, and expect the first initialization to be much slower than cached runs.

**"WASM load failed"**: Check browser console for network errors. The WASM runtime loads from `cdn.jsdelivr.net` — ensure it's not blocked by your network.

**"Unsupported offline model type"**: The model type you specified isn't supported on web. Check the supported model types table above.
