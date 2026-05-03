/**
 * Web feature configuration.
 *
 * Toggle features on/off and select which model to use per feature.
 * Disabled features won't load JS modules, won't inject preloaded model
 * states, and won't appear in the features list.
 *
 * This directly affects:
 *  - Which WASM JS modules are loaded at startup (main-sherpa-demo.ts)
 *  - Which models appear as "downloaded" in ModelManagement (constants.ts)
 *  - Which feature cards are visible on the Features page
 *
 * To reduce your web deployment size, disable unused features here AND remove
 * the corresponding model files from public/wasm/{feature}/.
 *
 * To swap a model, change the `modelId` here, then update
 * `web-models.config.json` to point at the new archive, and re-run
 * `./scripts/download-web-models.sh`. See packages/sherpa-onnx.rn/docs/WEB.md
 * for the full workflow.
 */

export interface WebFeatureEntry {
  enabled: boolean;
  /**
   * Model ID from AVAILABLE_MODELS / MODEL_CONFIGS.
   * See src/hooks/useModelConfig.ts for all available IDs.
   */
  modelId: string;
  /** External base URL for model files (for models too large for static hosting).
   *  Any CORS-enabled URL works: HuggingFace, GitHub releases, custom CDN. */
  modelBaseUrl?: string;
}

export type WebFeatureConfig = Record<string, WebFeatureEntry>;

/**
 * Current web feature configuration.
 * Set `enabled: false` to disable a feature on web.
 * Change `modelId` to use a different model for that feature.
 */
export const WEB_FEATURES = {
  /** Voice Activity Detection (~2 MB). */
  vad: {
    enabled: true,
    modelId: 'silero-vad-v5',
    modelBaseUrl:
      'https://huggingface.co/deeeed/sherpa-voice-models/resolve/main/vad',
  },

  /** Speech Recognition / streaming ASR (~200 MB).
   *  Alternatives: 'streaming-zipformer-en-20m-mobile', 'streaming-zipformer-bilingual-zh-en',
   *  'streaming-zipformer-multilingual', 'whisper-tiny-en' */
  asr: {
    enabled: true,
    modelId: 'streaming-zipformer-en-general',
    modelBaseUrl:
      'https://huggingface.co/deeeed/sherpa-voice-models/resolve/main/asr',
  },

  /** Text-to-Speech (~87 MB).
   *  Alternatives: 'vits-piper-en-medium', 'vits-piper-en-libritts_r-medium',
   *  'kokoro-en', 'kokoro-multi-lang-v1_1', 'matcha-icefall-en' */
  tts: {
    enabled: true,
    modelId: 'vits-icefall-en-low',
    modelBaseUrl:
      'https://huggingface.co/deeeed/sherpa-voice-models/resolve/main/tts',
  },

  /** Keyword Spotting (~10 MB).
   *  Alternatives: 'kws-zipformer-wenetspeech' */
  kws: {
    enabled: true,
    modelId: 'kws-zipformer-gigaspeech',
    modelBaseUrl:
      'https://huggingface.co/deeeed/sherpa-voice-models/resolve/main/kws',
  },

  /** Speaker Diarization (~15 MB). */
  diarization: {
    enabled: true,
    modelId: 'pyannote-segmentation-3-0',
    modelBaseUrl:
      'https://huggingface.co/deeeed/sherpa-voice-models/resolve/main/speakers',
  },

  /** Speech Enhancement / Denoising (~5 MB). */
  denoising: {
    enabled: true,
    modelId: 'gtcrn-speech-denoiser',
    modelBaseUrl:
      'https://huggingface.co/deeeed/sherpa-voice-models/resolve/main/enhancement',
  },

  /** Audio Tagging (~10 MB).
   *  Alternatives: 'ced-mini-audio-tagging', 'ced-base-audio-tagging' */
  audioTagging: {
    enabled: true,
    modelId: 'ced-tiny-audio-tagging',
    modelBaseUrl:
      'https://huggingface.co/deeeed/sherpa-voice-models/resolve/main/audio-tagging',
  },

  /** Language Identification (~40 MB).
   *  Alternatives: 'whisper-small-multilingual-lang-id' */
  languageId: {
    enabled: true,
    modelId: 'whisper-tiny-multilingual',
    modelBaseUrl:
      'https://huggingface.co/deeeed/sherpa-voice-models/resolve/main/language-id',
  },

  /** Speaker Identification (~7 MB).
   *  Alternatives: 'speaker-id-zh-cn', 'speaker-id-zh-en-advanced' */
  speakerId: {
    enabled: true,
    modelId: 'speaker-id-en-voxceleb',
    modelBaseUrl:
      'https://huggingface.co/deeeed/sherpa-voice-models/resolve/main/speaker-id',
  },

  /** Punctuation Restoration (~5 MB). */
  punctuation: {
    enabled: true,
    modelId: 'online-punct-en',
    modelBaseUrl:
      'https://huggingface.co/deeeed/sherpa-voice-models/resolve/main/punctuation',
  },
} satisfies Record<string, WebFeatureEntry>;

export type WebFeatureKey = keyof typeof WEB_FEATURES;

/**
 * Per-ASR-backend web model configuration.
 *
 * The asr WASM module is shared across all model types, but each backend
 * (whisper, sense_voice, qwen3, cohere_transcribe, ...) has its own files
 * hosted at its own CDN path. Add an entry here when uploading a new
 * backend's model files to the CDN. testASR(alias) on web reads this map
 * to resolve the right modelBaseUrl + default test wav.
 *
 * Leave the map empty for backends whose model files have not been
 * uploaded yet — testASR will throw a clear error in that case.
 */
export interface WebAsrBackendEntry {
  /** CDN base where the backend's model files live. */
  modelBaseUrl: string;
  /** Optional default test wav URL. If unset, callers must pass wavPath. */
  defaultWavUrl?: string;
}

const HF_BASE =
  'https://huggingface.co/deeeed/sherpa-voice-models/resolve/main';

export const WEB_ASR_BACKENDS: Record<string, WebAsrBackendEntry> = {
  // Streaming Zipformer (the model that backs WEB_FEATURES.asr by default).
  streaming: {
    modelBaseUrl: `${HF_BASE}/asr`,
  },

  // Cohere Transcribe 14-lang int8.
  // Upload model files (encoder.int8.onnx, decoder.int8.onnx, tokens.txt,
  // optional test_wavs/en.wav) to https://huggingface.co/deeeed/sherpa-voice-models
  // under `asr-cohere/`, then this entry resolves automatically.
  cohere: {
    modelBaseUrl: `${HF_BASE}/asr-cohere`,
    defaultWavUrl: `${HF_BASE}/asr-cohere/test_wavs/en.wav`,
  },

  // Qwen3-ASR 0.6B int8.
  // Upload model files (encoder.int8.onnx, decoder.int8.onnx,
  // conv_frontend.onnx, tokenizer/*) to `asr-qwen3/` in the same HF repo.
  qwen3: {
    modelBaseUrl: `${HF_BASE}/asr-qwen3`,
    defaultWavUrl: `${HF_BASE}/asr-qwen3/test_wavs/raokouling.wav`,
  },

  // Whisper small multilingual.
  // Upload to `asr-whisper-small/`.
  whisper: {
    modelBaseUrl: `${HF_BASE}/asr-whisper-small`,
    defaultWavUrl: `${HF_BASE}/asr-whisper-small/test_wavs/0.wav`,
  },
};

export function getWebAsrBackend(alias: string): WebAsrBackendEntry | undefined {
  return WEB_ASR_BACKENDS[alias];
}

/**
 * Detect the WASM base path at runtime.
 * In production with a base URL (e.g. /audiolab/sherpa-voice/),
 * Expo prefixes asset paths. We derive the wasm path from the main bundle
 * script tag that Expo generates.
 */
export function getWasmBasePath(): string {
  if (typeof document === 'undefined') return '/wasm/';
  const scriptEl = document.querySelector<HTMLScriptElement>(
    'script[src*="_expo/static"]'
  );
  if (scriptEl?.src) {
    try {
      const url = new URL(scriptEl.src);
      // e.g. /audiolab/sherpa-voice/_expo/static/js/...
      const idx = url.pathname.indexOf('_expo/static');
      if (idx > 0) {
        return url.pathname.substring(0, idx) + 'wasm/';
      }
    } catch { /* fall through */ }
  }
  return '/wasm/';
}

/** WASM module filenames per feature (without base path prefix). */
const WEB_FEATURE_MODULE_FILES: Record<WebFeatureKey, string> = {
  vad: 'sherpa-onnx-vad.js',
  asr: 'sherpa-onnx-asr.js',
  tts: 'sherpa-onnx-tts.js',
  kws: 'sherpa-onnx-kws.js',
  diarization: 'sherpa-onnx-speaker.js',
  denoising: 'sherpa-onnx-enhancement.js',
  audioTagging: 'sherpa-onnx-audio-tagging.js',
  languageId: 'sherpa-onnx-language-id.js',
  speakerId: 'sherpa-onnx-speaker-id.js',
  punctuation: 'sherpa-onnx-punctuation.js',
};

/**
 * Map from feature key to the WASM JS module path.
 * @deprecated Use getEnabledModulePaths() which applies the correct base path.
 */
export const WEB_FEATURE_MODULES: Record<WebFeatureKey, string> = Object.fromEntries(
  Object.entries(WEB_FEATURE_MODULE_FILES).map(([k, v]) => [k, '/wasm/' + v])
) as Record<WebFeatureKey, string>;

/**
 * Map from feature key to the route path used in the features index.
 * Used to filter feature cards on web.
 */
export const WEB_FEATURE_ROUTES: Record<WebFeatureKey, string> = {
  vad: '/(tabs)/features/vad',
  asr: '/(tabs)/features/asr',
  tts: '/(tabs)/features/tts',
  kws: '/(tabs)/features/kws',
  diarization: '/(tabs)/features/diarization',
  denoising: '/(tabs)/features/denoising',
  audioTagging: '/(tabs)/features/audio-tagging',
  languageId: '/(tabs)/features/language-id',
  speakerId: '/(tabs)/features/speaker-id',
  punctuation: '/(tabs)/features/punctuation',
};

/** Returns the list of enabled WASM JS module paths with correct base path. */
export function getEnabledModulePaths(): string[] {
  const base = getWasmBasePath();
  const paths: string[] = [];
  for (const [key, entry] of Object.entries(WEB_FEATURES)) {
    if (entry.enabled) {
      paths.push(base + WEB_FEATURE_MODULE_FILES[key as WebFeatureKey]);
    }
  }
  return paths;
}

/** Check if a feature route is enabled on web. */
export function isWebFeatureRouteEnabled(route: string): boolean {
  for (const [key, featureRoute] of Object.entries(WEB_FEATURE_ROUTES)) {
    if (route === featureRoute) {
      return WEB_FEATURES[key as WebFeatureKey].enabled;
    }
  }
  // Route not in the map — always enabled (e.g. home, about)
  return true;
}
