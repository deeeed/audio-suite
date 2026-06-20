import { loadCombinedWasm } from '../wasmLoader';
import type { OnlinePunctuationInstance } from '../wasmTypes';
import { type Constructor, withDownloadProgress } from './mixinUtils';

export function PunctuationMixin<TBase extends Constructor>(Base: TBase) {
  return class extends Base {
    public punctuation: OnlinePunctuationInstance | null = null;

    async initPunctuation(config: any): Promise<{
      success: boolean;
      error?: string;
    }> {
      try {
        await loadCombinedWasm();

        if (!window.SherpaOnnx.Punctuation) {
          return { success: false, error: 'Punctuation module not loaded' };
        }

        const debug = config?.debug ? 1 : 0;
        const numThreads = 1; // WASM is single-threaded

        if (config?.model) {
          console.warn(
            '[Punctuation] Offline CT-Transformer punctuation is not supported on web; using online CNN-BiLSTM instead.'
          );
        }

        console.log(
          `[Punctuation] Loading model (threads=${numThreads}, debug=${debug})...`
        );
        // Web-only: config.modelDir is set to '/wasm/punctuation' by ModelManagement
        // (createWebPunctuationModelState in constants.ts), pointing to model files
        // pre-served by download-web-models.sh. Native Punctuation uses the TurboModule.
        const modelDir = config?.modelDir || '/wasm/punctuation';
        const fetchBase = config?.modelBaseUrl || modelDir;

        const loadedModel = await withDownloadProgress(config?.onProgress, () =>
          window.SherpaOnnx.Punctuation!.loadModel({
            cnnBilstm: `${fetchBase}/model.onnx`,
            bpeVocab: `${fetchBase}/bpe.vocab`,
            modelDir,
            debug,
          })
        );

        this.punctuation = window.SherpaOnnx.Punctuation.createPunctuation(
          loadedModel,
          { numThreads, debug }
        );
        console.log('[Punctuation] Initialized successfully');
        return { success: true };
      } catch (error) {
        console.error('[Punctuation] initPunctuation failed:', error);
        return { success: false, error: (error as Error).message };
      }
    }

    async addPunctuation(text: string): Promise<{
      success: boolean;
      text: string;
      durationMs: number;
      error?: string;
    }> {
      if (!this.punctuation) {
        return {
          success: false,
          text: '',
          durationMs: 0,
          error: 'Punctuation not initialized',
        };
      }
      try {
        const startMs = performance.now();
        const result = this.punctuation.addPunct(text);
        const durationMs = performance.now() - startMs;
        return { success: true, text: result, durationMs };
      } catch (error) {
        return {
          success: false,
          text: '',
          durationMs: 0,
          error: (error as Error).message,
        };
      }
    }

    async releasePunctuation(): Promise<{ released: boolean }> {
      if (this.punctuation) {
        try {
          this.punctuation.free();
        } catch (_) {
          console.error('[Punctuation] releasePunctuation failed:', _);
        }
        this.punctuation = null;
      }
      return { released: true };
    }
  };
}
