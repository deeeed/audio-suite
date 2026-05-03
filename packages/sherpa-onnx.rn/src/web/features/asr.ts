import { loadCombinedWasm, detectWasmBasePath } from '../wasmLoader';
import { decodeWav } from '../audioUtils';
import type {
  OnlineRecognizer,
  OnlineStream,
  OfflineRecognizer,
} from '../wasmTypes';
import type {
  AsrInitResult,
  AsrModelConfig,
  AsrRecognizeResult,
} from '../../types/interfaces';
import type { WaveformInput } from '../../types/api';
import { type Constructor, withDownloadProgress } from './mixinUtils';
import { WasmWorkerManager } from '../workers/WasmWorkerManager';

/**
 * Model types that only support offline (non-streaming) recognition on web.
 * These have dedicated fields in the WASM offline recognizer config struct
 * (_initOfflineRecognizerConfig in sherpa-onnx-asr.js) but NOT in the online
 * config struct.
 */
const OFFLINE_ONLY_TYPES: ReadonlySet<string> = new Set([
  'whisper',
  'paraformer',
  'nemo_ctc',
  'nemo_transducer',
  'canary',
  'moonshine',
  'sense_voice',
  'fire_red_asr',
  'dolphin',
  'tdnn',
  'telespeech_ctc',
  'wenet_ctc',
  'zipformer2_ctc',
  'lstm',
]);

/**
 * Normalize user-facing model type to the WASM loadModel type for online path.
 */
function toOnlineLoadType(rawType: string): string {
  switch (rawType) {
    case 'zipformer':
    case 'zipformer2':
      return 'transducer';
    default:
      return rawType;
  }
}

/** Ensure a directory exists in the Emscripten virtual FS. */
function ensureDir(dir: string): void {
  try {
    if (!window.Module.FS.analyzePath(dir).exists) {
      window.Module.FS.mkdir(dir);
    }
  } catch {
    // Already exists
  }
}

/** Load a file from URL to the Emscripten virtual FS. Returns the FS path. */
async function loadFile(
  url: string,
  fsPath: string,
  debug: number
): Promise<string> {
  const result = await window.SherpaOnnx.FileSystem.safeLoadFile(
    url,
    fsPath,
    debug
  );
  if (!result) {
    throw new Error(`Failed to load model file: ${url}`);
  }
  return result.path;
}

/** Resolve a model file URL from config.modelFiles or a default name. */
function furl(
  fetchBase: string,
  mf: AsrModelConfig['modelFiles'] | undefined,
  key: keyof NonNullable<AsrModelConfig['modelFiles']>,
  defaultName: string
): string {
  return `${fetchBase}/${mf?.[key] || defaultName}`;
}

interface OfflineAsrFile { url: string; fsPath: string; optional?: boolean }

/**
 * Pre-compute the file list and recognizer config for offline ASR without
 * actually loading any files.  Used by the worker path so that all
 * model-type-specific logic stays in TypeScript on the main thread.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildOfflineAsrPlan(
  fetchBase: string,
  modelDir: string,
  rawType: string,
  config: AsrModelConfig,
  mf: AsrModelConfig['modelFiles'] | undefined,
  opts: { debug: number; numThreads: number; sampleRate: number; decodingMethod: string; maxActivePaths: number }
): { files: OfflineAsrFile[]; recognizerConfig: Record<string, any> } {
  const files: OfflineAsrFile[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mc: Record<string, any> = {
    numThreads: opts.numThreads,
    debug: opts.debug,
    provider: 'cpu',
  };

  // Helper to register a file and return its FS path
  const f = (key: keyof NonNullable<AsrModelConfig['modelFiles']>, defaultName: string): string => {
    const url = furl(fetchBase, mf, key, defaultName);
    const fsPath = `${modelDir}/${mf?.[key] || defaultName}`;
    files.push({ url, fsPath });
    return fsPath;
  };

  // Most backends use a single tokens.txt. Qwen3 ships a tokenizer/ dir
  // instead and registers its own files in the qwen3 case below — but the
  // master OfflineModelConfig struct still has a tokens slot, so set it to
  // empty string for qwen3 so stringToUTF8 doesn't choke on undefined.
  if (rawType === 'qwen3') {
    mc.tokens = '';
  } else {
    mc.tokens = f('tokens', 'tokens.txt');
  }

  switch (rawType) {
    case 'whisper':
      mc.whisper = {
        encoder: f('encoder', 'encoder.onnx'),
        decoder: f('decoder', 'decoder.onnx'),
        language: config.language ?? '',
        task: config.task ?? 'transcribe',
      };
      break;
    case 'canary':
      mc.canary = {
        encoder: f('encoder', 'encoder.onnx'),
        decoder: f('decoder', 'decoder.onnx'),
        srcLang: config.srcLang ?? 'en',
        tgtLang: config.tgtLang ?? 'en',
        usePnc: config.usePnc ?? true,
      };
      break;
    case 'moonshine':
      mc.moonshine = { preprocessor: f('preprocessor', 'preprocessor.onnx'), encoder: f('encoder', 'encoder.onnx'), uncachedDecoder: f('uncachedDecoder', 'uncached_decoder.onnx'), cachedDecoder: f('cachedDecoder', 'cached_decoder.onnx') };
      break;
    case 'sense_voice':
      mc.senseVoice = {
        model: f('model', 'model.onnx'),
        language: config.language ?? '',
        useInverseTextNormalization: config.useItn ?? true,
      };
      break;
    case 'fire_red_asr':
      mc.fireRedAsr = { encoder: f('encoder', 'encoder.onnx'), decoder: f('decoder', 'decoder.onnx') };
      break;
    case 'dolphin':
      mc.dolphin = { model: f('model', 'model.onnx') };
      break;
    case 'tdnn':
      mc.tdnn = { model: f('model', 'model.onnx') };
      break;
    case 'telespeech_ctc':
      mc.telespeechCtc = f('model', 'model.onnx');
      break;
    case 'transducer': case 'zipformer': case 'zipformer2': case 'nemo_transducer':
      mc.transducer = { encoder: f('encoder', 'encoder.onnx'), decoder: f('decoder', 'decoder.onnx'), joiner: f('joiner', 'joiner.onnx') };
      break;
    case 'paraformer':
      mc.paraformer = { model: f('model', 'model.onnx') };
      break;
    case 'nemo_ctc': case 'wenet_ctc': case 'zipformer2_ctc':
      mc.nemoCtc = { model: f('model', 'model.onnx') };
      break;
    case 'cohere_transcribe': {
      const encoderName = mf?.encoder ?? 'encoder.int8.onnx';
      const decoderName = mf?.decoder ?? 'decoder.int8.onnx';
      // The encoder/decoder ONNX models reference `<name>.data` sidecar
      // weight files via ONNX external-data references. Fetch them into
      // MEMFS at the same relative path so the runtime can resolve them.
      // Native handlers don't need this — extracted tarballs already
      // include the .data files in the model directory.
      files.push({
        url: `${fetchBase}/${encoderName}.data`,
        fsPath: `${modelDir}/${encoderName}.data`,
      });
      // decoder.int8.onnx may or may not have a .data sidecar depending on
      // the model variant. Probe with HEAD before forcing the fetch.
      const decoderDataUrl = `${fetchBase}/${decoderName}.data`;
      files.push({
        url: decoderDataUrl,
        fsPath: `${modelDir}/${decoderName}.data`,
        optional: true,
      });
      mc.cohereTranscribe = {
        encoder: f('encoder', 'encoder.int8.onnx'),
        decoder: f('decoder', 'decoder.int8.onnx'),
        language: config.language ?? '',
        usePunct: config.usePunct ?? true,
        useInverseTextNormalization: config.useItn ?? true,
      };
      break;
    }
    case 'qwen3': {
      // Qwen3-ASR ships a GPT-style tokenizer (vocab.json + merges.txt +
      // tokenizer_config.json) in a `tokenizer/` directory. Each file gets
      // fetched into MEMFS individually because the wasm pipeline can't mount
      // a directory. Caller can override the file list via
      // `config.qwen3.tokenizerFiles` to handle other layouts (e.g.
      // tokenizer.json fast tokenizer or special_tokens_map.json variants).
      // Defaults are marked optional so a model that ships only a subset
      // doesn't 404 the whole init — only an explicitly-passed override list
      // is treated as required.
      const callerFiles = config.qwen3?.tokenizerFiles;
      const tokenizerFiles = callerFiles ?? [
        'vocab.json',
        'merges.txt',
        'tokenizer_config.json',
      ];
      const filesAreOptional = !callerFiles;
      const tokenizerDir = `${modelDir}/tokenizer`;
      for (const fname of tokenizerFiles) {
        files.push({
          url: `${fetchBase}/tokenizer/${fname}`,
          fsPath: `${tokenizerDir}/${fname}`,
          optional: filesAreOptional,
        });
      }
      mc.qwen3Asr = {
        encoder: f('encoder', 'encoder.int8.onnx'),
        decoder: f('decoder', 'decoder.int8.onnx'),
        convFrontend: f('convFrontend', 'conv_frontend.onnx'),
        tokenizer: tokenizerDir,
        hotwords: '',
      };
      break;
    }
    default:
      throw new Error(`Unsupported offline model type on web: ${rawType}`);
  }

  return {
    files,
    recognizerConfig: {
      featConfig: { sampleRate: opts.sampleRate, featureDim: 80 },
      modelConfig: mc,
      lmConfig: { model: '', scale: 0 },
      decodingMethod: opts.decodingMethod,
      maxActivePaths: opts.maxActivePaths,
    },
  };
}

export function AsrMixin<TBase extends Constructor>(Base: TBase) {
  return class extends Base {
    public asrOnlineRecognizer: OnlineRecognizer | null = null;
    public asrOnlineStream: OnlineStream | null = null;
    public asrOfflineRecognizer: OfflineRecognizer | null = null;
    public asrWorkerManager: WasmWorkerManager | null = null;

    async initAsr(config: AsrModelConfig): Promise<AsrInitResult> {
      try {
        const debug = config.debug ? 1 : 0;
        const numThreads = 1;
        const sampleRate = 16000;
        const modelDir = config.modelDir || '/wasm/asr';
        const fetchBase = config.modelBaseUrl || modelDir;
        const rawType = config.modelType || 'transducer';

        // Offline if type is offline-only or user explicitly set streaming: false
        const useOffline =
          OFFLINE_ONLY_TYPES.has(rawType) || config.streaming === false;

        if (useOffline) {
          return await this._initOfflineAsr(config, {
            debug,
            numThreads,
            sampleRate,
            modelDir,
            fetchBase,
            rawType,
          });
        }
        await loadCombinedWasm();
        return await this._initOnlineAsr(config, {
          debug,
          numThreads,
          sampleRate,
          modelDir,
          fetchBase,
          rawType,
        });
      } catch (error) {
        console.error('[ASR] initAsr failed:', error);
        return { success: false, error: (error as Error).message };
      }
    }

    /**
     * Online (streaming) ASR — uses WASM loadModel + createOnlineRecognizer.
     */
    async _initOnlineAsr(
      config: AsrModelConfig,
      opts: {
        debug: number;
        numThreads: number;
        sampleRate: number;
        modelDir: string;
        fetchBase: string;
        rawType: string;
      }
    ): Promise<AsrInitResult> {
      const { debug, numThreads, sampleRate, modelDir, fetchBase, rawType } =
        opts;
      const asrType = toOnlineLoadType(rawType);
      const mf = config.modelFiles;

      const loadedModel = await withDownloadProgress(config.onProgress, () =>
        window.SherpaOnnx.ASR.loadModel({
          type: asrType,
          encoder: furl(fetchBase, mf, 'encoder', 'encoder.onnx'),
          decoder: furl(fetchBase, mf, 'decoder', 'decoder.onnx'),
          joiner: furl(fetchBase, mf, 'joiner', 'joiner.onnx'),
          tokens: furl(fetchBase, mf, 'tokens', 'tokens.txt'),
          model: furl(fetchBase, mf, 'model', 'model.onnx'),
          modelDir,
          debug,
        })
      );

      this.asrOnlineRecognizer =
        window.SherpaOnnx.ASR.createOnlineRecognizer(loadedModel, {
          sampleRate,
          numThreads,
          debug,
          decodingMethod: config.decodingMethod ?? 'greedy_search',
          maxActivePaths: config.maxActivePaths ?? 4,
          enableEndpoint: config.streaming ? 1 : 0,
        });

      if (!this.asrOnlineRecognizer || !this.asrOnlineRecognizer.handle) {
        return {
          success: false,
          error: 'Failed to create online recognizer — WASM config error',
        };
      }

      return { success: true, sampleRate, modelType: rawType };
    }

    /**
     * Offline (non-streaming) ASR.
     * Loads model files to the Emscripten virtual FS and creates the
     * recognizer directly via the WASM OfflineRecognizer constructor,
     * which supports all model types (whisper, moonshine, sense_voice, etc.).
     */
    async _initOfflineAsr(
      config: AsrModelConfig,
      opts: {
        debug: number;
        numThreads: number;
        sampleRate: number;
        modelDir: string;
        fetchBase: string;
        rawType: string;
      }
    ): Promise<AsrInitResult> {
      const { debug, numThreads, sampleRate, modelDir, fetchBase, rawType } =
        opts;
      const mf = config.modelFiles;

      // Try worker path first for non-blocking offline inference
      if (WasmWorkerManager.shouldUse()) {
        try {
          const plan = buildOfflineAsrPlan(fetchBase, modelDir, rawType, config, mf, {
            debug, numThreads, sampleRate,
            decodingMethod: config.decodingMethod ?? 'greedy_search',
            maxActivePaths: config.maxActivePaths ?? 4,
          });
          const mgr = new WasmWorkerManager('asr-offline');
          await mgr.init(detectWasmBasePath(), {
            modelDir,
            debug,
            files: plan.files,
            recognizerConfig: plan.recognizerConfig,
          });
          this.asrWorkerManager = mgr;
          console.log(`[ASR] Worker initialized for offline ${rawType}`);
          return { success: true, sampleRate, modelType: rawType };
        } catch (e) {
          console.warn('[ASR] Worker init failed, falling back to main thread:', e);
        }
      }

      await loadCombinedWasm();
      ensureDir(modelDir);

      const plan = buildOfflineAsrPlan(fetchBase, modelDir, rawType, config, mf, {
        debug,
        numThreads,
        sampleRate,
        decodingMethod: config.decodingMethod ?? 'greedy_search',
        maxActivePaths: config.maxActivePaths ?? 4,
      });

      const offlineConfig = await withDownloadProgress(
        config.onProgress,
        async () => {
          for (const f of plan.files) {
            try {
              await loadFile(f.url, f.fsPath, debug);
            } catch (err) {
              if (f.optional) {
                if (debug) console.log(`[ASR] optional file missing, continuing: ${f.url}`);
                continue;
              }
              throw err;
            }
          }
          return plan.recognizerConfig;
        }
      );

      // Create offline recognizer directly via the WASM constructor.
      // This bypasses createOfflineRecognizer() which only handles
      // transducer/paraformer/ctc — _initOfflineRecognizerConfig handles all types.
      if (debug) {
        console.log('[ASR] offlineConfig:', JSON.stringify(offlineConfig, null, 2));
        console.log('[ASR] OfflineRecognizer exists:', typeof (window as any).OfflineRecognizer);
        console.log('[ASR] Module.ccall exists:', typeof window.Module?.ccall);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recognizer = new (window as any).OfflineRecognizer(
        offlineConfig,
        window.Module
      );

      // Track resource for cleanup (matches createOfflineRecognizer behavior)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window.SherpaOnnx as any).trackResource) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window.SherpaOnnx as any).trackResource('asr', recognizer);
      }

      if (!recognizer || !recognizer.handle) {
        return {
          success: false,
          error: 'Failed to create offline recognizer — WASM config error',
        };
      }

      this.asrOfflineRecognizer = recognizer;
      return { success: true, sampleRate, modelType: rawType };
    }

    async recognizeFromSamples({
      sampleRate,
      samples,
    }: WaveformInput): Promise<AsrRecognizeResult> {
      const float32 = new Float32Array(samples);
      if (this.asrWorkerManager) {
        return this._recognizeWorker(sampleRate, float32);
      }
      if (this.asrOfflineRecognizer) {
        return this._recognizeOffline(sampleRate, float32);
      }
      if (!this.asrOnlineRecognizer) {
        return { success: false, text: '', error: 'ASR not initialized' };
      }
      return this._recognizeOnline(sampleRate, float32);
    }

    async recognizeFromFile(filePath: string): Promise<AsrRecognizeResult> {
      if (
        !this.asrOfflineRecognizer &&
        !this.asrOnlineRecognizer &&
        !this.asrWorkerManager
      ) {
        return { success: false, text: '', error: 'ASR not initialized' };
      }
      try {
        const response = await fetch(filePath);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${filePath}: ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        const decoded = decodeWav(buffer);
        if (!decoded) {
          throw new Error(
            'Unsupported audio format — only 16-bit PCM WAV is supported on web'
          );
        }
        if (this.asrWorkerManager) {
          return this._recognizeWorker(decoded.sampleRate, decoded.samples);
        }
        if (this.asrOfflineRecognizer) {
          return this._recognizeOffline(decoded.sampleRate, decoded.samples);
        }
        return this._recognizeOnline(decoded.sampleRate, decoded.samples);
      } catch (error) {
        return {
          success: false,
          text: '',
          error: (error as Error).message,
        };
      }
    }

    async _recognizeWorker(
      sampleRate: number,
      float32: Float32Array
    ): Promise<AsrRecognizeResult> {
      try {
        const result = await this.asrWorkerManager!.process(
          { samples: float32, sampleRate },
          [float32.buffer]
        );
        return { success: true, text: result.text };
      } catch (error) {
        return { success: false, text: '', error: (error as Error).message };
      }
    }

    _recognizeOffline(
      sampleRate: number,
      float32: Float32Array
    ): AsrRecognizeResult {
      try {
        const stream = this.asrOfflineRecognizer!.createStream();
        try {
          stream.acceptWaveform(sampleRate, float32);
          this.asrOfflineRecognizer!.decode(stream);
          const result = this.asrOfflineRecognizer!.getResult(stream);
          return { success: true, text: result.text };
        } finally {
          stream.free();
        }
      } catch (error) {
        return { success: false, text: '', error: (error as Error).message };
      }
    }

    _recognizeOnline(
      sampleRate: number,
      float32: Float32Array
    ): AsrRecognizeResult {
      try {
        const stream = this.asrOnlineRecognizer!.createStream();
        try {
          stream.acceptWaveform(sampleRate, float32);
          stream.inputFinished();
          while (this.asrOnlineRecognizer!.isReady(stream)) {
            this.asrOnlineRecognizer!.decode(stream);
          }
          const result = this.asrOnlineRecognizer!.getResult(stream);
          return { success: true, text: result.text };
        } finally {
          stream.free();
        }
      } catch (error) {
        return { success: false, text: '', error: (error as Error).message };
      }
    }

    async releaseAsr(): Promise<{ released: boolean }> {
      if (this.asrWorkerManager) {
        await this.asrWorkerManager.release();
        this.asrWorkerManager = null;
      }
      if (this.asrOnlineStream) {
        try {
          this.asrOnlineStream.free();
        } catch (_) {
          console.error('[ASR] releaseAsr stream failed:', _);
        }
        this.asrOnlineStream = null;
      }
      if (this.asrOnlineRecognizer) {
        try {
          this.asrOnlineRecognizer.free();
        } catch (_) {
          console.error('[ASR] releaseAsr recognizer failed:', _);
        }
        this.asrOnlineRecognizer = null;
      }
      if (this.asrOfflineRecognizer) {
        try {
          this.asrOfflineRecognizer.free();
        } catch (_) {
          console.error('[ASR] releaseAsr offline recognizer failed:', _);
        }
        this.asrOfflineRecognizer = null;
      }
      return { released: true };
    }

    async createAsrOnlineStream(): Promise<{ success: boolean }> {
      if (!this.asrOnlineRecognizer) {
        return { success: false };
      }
      // Free previous stream if any
      if (this.asrOnlineStream) {
        try {
          this.asrOnlineStream.free();
        } catch (_) {
          /* ignore */
        }
      }
      this.asrOnlineStream = this.asrOnlineRecognizer.createStream();
      return { success: true };
    }

    async acceptAsrOnlineWaveform({
      sampleRate,
      samples,
    }: WaveformInput): Promise<{ success: boolean }> {
      if (!this.asrOnlineRecognizer || !this.asrOnlineStream) {
        return { success: false };
      }
      const float32 = new Float32Array(samples);
      this.asrOnlineStream.acceptWaveform(sampleRate, float32);
      while (this.asrOnlineRecognizer.isReady(this.asrOnlineStream)) {
        this.asrOnlineRecognizer.decode(this.asrOnlineStream);
      }
      return { success: true };
    }

    async isAsrOnlineEndpoint(): Promise<{ isEndpoint: boolean }> {
      if (!this.asrOnlineRecognizer || !this.asrOnlineStream) {
        return { isEndpoint: false };
      }
      return {
        isEndpoint: this.asrOnlineRecognizer.isEndpoint(this.asrOnlineStream),
      };
    }

    async getAsrOnlineResult(): Promise<{
      text: string;
      tokens: string[];
      timestamps: number[];
    }> {
      if (!this.asrOnlineRecognizer || !this.asrOnlineStream) {
        return { text: '', tokens: [], timestamps: [] };
      }
      const result = this.asrOnlineRecognizer.getResult(this.asrOnlineStream);
      return { text: result.text, tokens: result.tokens ?? [], timestamps: [] };
    }

    async resetAsrOnlineStream(): Promise<{ success: boolean }> {
      if (!this.asrOnlineRecognizer || !this.asrOnlineStream) {
        return { success: false };
      }
      this.asrOnlineRecognizer.reset(this.asrOnlineStream);
      return { success: true };
    }
  };
}
