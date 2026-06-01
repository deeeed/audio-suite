import type { ApiInterface } from '../types/api';
import type {
  PunctuationModelConfig,
  PunctuationInitResult,
  PunctuationResult,
  ValidateResult,
} from '../types/interfaces';
import { cleanFilePath } from '../utils/fileUtils';

export class PunctuationService {
  private initialized = false;
  private api: ApiInterface;

  constructor(api: ApiInterface) {
    this.api = api;
  }

  public validateLibrary(): Promise<ValidateResult> {
    return this.api.validateLibraryLoaded();
  }

  public async init(config: PunctuationModelConfig): Promise<PunctuationInitResult> {
    try {
      const validateResult = await this.validateLibrary();
      if (!validateResult.loaded) {
        return {
          success: false,
          error: validateResult.status || 'Library not loaded',
        };
      }

      const nativeConfig: Record<string, unknown> = {
        modelDir: cleanFilePath(config.modelDir),
        cnnBilstm: config.cnnBilstm,
        bpeVocab: config.bpeVocab,
        numThreads: config.numThreads ?? 1,
        debug: config.debug ?? false,
        provider: config.provider ?? 'cpu',
        ...(config.model !== undefined ? { model: config.model } : {}),
        ...(config.modelBaseUrl && { modelBaseUrl: config.modelBaseUrl }),
        ...(config.onProgress && { onProgress: config.onProgress }),
      };

      const result = await this.api.initPunctuation(nativeConfig as any);

      if (result.success) {
        this.initialized = true;
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async addPunctuation(text: string): Promise<PunctuationResult> {
    try {
      if (!this.initialized) {
        return {
          success: false,
          text: '',
          durationMs: 0,
          error: 'Punctuation is not initialized',
        };
      }

      return await this.api.addPunctuation(text);
    } catch (error) {
      return {
        success: false,
        text: '',
        durationMs: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async release(): Promise<{ released: boolean }> {
    try {
      const result = await this.api.releasePunctuation();
      if (result.released) {
        this.initialized = false;
      }
      return result;
    } catch (error) {
      console.error('Error releasing Punctuation resources:', error);
      return { released: false };
    }
  }
}
