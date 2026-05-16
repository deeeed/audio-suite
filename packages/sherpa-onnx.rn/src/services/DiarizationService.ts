import type { ApiInterface } from '../types/api';
import type {
  DiarizationModelConfig,
  DiarizationInitResult,
  DiarizationResult,
  ValidateResult,
} from '../types/interfaces';
import { cleanFilePath } from '../utils/fileUtils';

export class DiarizationService {
  private initialized = false;
  private sampleRate = 0;
  private api: ApiInterface;

  constructor(api: ApiInterface) {
    this.api = api;
  }

  public getSampleRate(): number {
    return this.sampleRate;
  }

  public validateLibrary(): Promise<ValidateResult> {
    return this.api.validateLibraryLoaded();
  }

  public async init(config: DiarizationModelConfig): Promise<DiarizationInitResult> {
    try {
      const validateResult = await this.validateLibrary();
      if (!validateResult.loaded) {
        return {
          success: false,
          sampleRate: 0,
          error: validateResult.status || 'Library not loaded',
        };
      }

      const cleanedConfig = {
        ...config,
        segmentationModelDir: cleanFilePath(config.segmentationModelDir),
        segmentationModelFile: config.segmentationModelFile
          ? cleanFilePath(config.segmentationModelFile)
          : undefined,
        embeddingModelFile: cleanFilePath(config.embeddingModelFile),
      };

      const result = await this.api.initDiarization(cleanedConfig);
      if (result.success) {
        this.initialized = true;
        this.sampleRate = result.sampleRate;
      }
      return result;
    } catch (error) {
      return {
        success: false,
        sampleRate: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async processFile(
    filePath: string,
    numClusters: number = -1,
    threshold: number = 0.5
  ): Promise<DiarizationResult> {
    try {
      if (!this.initialized) {
        return {
          success: false,
          segments: [],
          numSpeakers: 0,
          durationMs: 0,
          error: 'Diarization is not initialized',
        };
      }
      return await this.api.processDiarizationFile({
        filePath: cleanFilePath(filePath),
        numClusters,
        threshold,
      });
    } catch (error) {
      return {
        success: false,
        segments: [],
        numSpeakers: 0,
        durationMs: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async processFileWindow(
    filePath: string,
    startTimeMs: number,
    durationMs: number,
    numClusters: number = -1,
    threshold: number = 0.5
  ): Promise<DiarizationResult> {
    try {
      if (!this.initialized) {
        return {
          success: false,
          segments: [],
          numSpeakers: 0,
          durationMs: 0,
          error: 'Diarization is not initialized',
        };
      }
      return await this.api.processDiarizationFileWindow({
        filePath: cleanFilePath(filePath),
        startTimeMs,
        durationMs,
        numClusters,
        threshold,
      });
    } catch (error) {
      return {
        success: false,
        segments: [],
        numSpeakers: 0,
        durationMs: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async release(): Promise<{ released: boolean }> {
    try {
      const result = await this.api.releaseDiarization();
      if (result.released) {
        this.initialized = false;
        this.sampleRate = 0;
      }
      return result;
    } catch (error) {
      console.error('Error releasing Diarization resources:', error);
      return { released: false };
    }
  }
}
