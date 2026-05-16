/**
 * ASR Service for automatic speech recognition functionality
 */

import type { ApiInterface } from '../types/api';
import type {
  AsrModelConfig,
  AsrInitResult,
  AsrRecognizeResult,
} from '../types/interfaces';
import { cleanFilePath } from '../utils/fileUtils';

/**
 * Service for Automatic Speech Recognition functionality
 */
export class AsrService {
  private initialized = false;
  private api: ApiInterface;

  constructor(api: ApiInterface) {
    this.api = api;
  }

  /**
   * Initialize the ASR engine
   * @param config The ASR model configuration
   * @returns Promise resolving to initialization result
   */
  public async initialize(config: AsrModelConfig): Promise<AsrInitResult> {
    try {
      // First validate library
      const validation = await this.api.validateLibraryLoaded();
      if (!validation.loaded) {
        throw new Error(`Library validation failed: ${validation.status}`);
      }

      const cleanedConfig = {
        ...config,
        modelDir: cleanFilePath(config.modelDir),
      };
      // Note: passing a streaming-only model with streaming: false will produce
      // a cryptic native error. See AsrModelConfig.streaming JSDoc for compatible types.
      const result = await this.api.initAsr(cleanedConfig);
      this.initialized = result.success;
      return result;
    } catch (error) {
      this.initialized = false;
      throw error;
    }
  }

  /**
   * Recognize speech from audio samples
   * @param sampleRate The sample rate of the audio
   * @param samples Float array of audio samples
   * @returns Promise resolving to recognition result
   */
  public async recognizeFromSamples(
    sampleRate: number,
    samples: number[]
  ): Promise<AsrRecognizeResult> {
    if (!this.initialized) {
      throw new Error('ASR is not initialized. Call initialize() first.');
    }

    return this.api.recognizeFromSamples({ sampleRate, samples });
  }

  /**
   * Recognize speech from an audio file
   * @param filePath Path to the audio file
   * @returns Promise resolving to recognition result
   */
  public async recognizeFromFile(
    filePath: string
  ): Promise<AsrRecognizeResult> {
    if (!this.initialized) {
      throw new Error('ASR is not initialized. Call initialize() first.');
    }

    return this.api.recognizeFromFile(cleanFilePath(filePath));
  }

  /**
   * Create a persistent online stream for live streaming ASR.
   * Requires initAsr with streaming=true to have been called first.
   */
  public async createOnlineStream(): Promise<{ success: boolean }> {
    if (!this.initialized) {
      throw new Error('ASR is not initialized. Call initialize() first.');
    }
    return this.api.createAsrOnlineStream();
  }

  /**
   * Feed audio samples to the online stream and decode ready frames.
   */
  public async acceptWaveform(
    sampleRate: number,
    samples: number[]
  ): Promise<{ success: boolean }> {
    if (!this.initialized) {
      throw new Error('ASR is not initialized. Call initialize() first.');
    }
    return this.api.acceptAsrOnlineWaveform({ sampleRate, samples });
  }

  /**
   * Check if an endpoint (sentence boundary) has been detected.
   */
  public async isEndpoint(): Promise<{ isEndpoint: boolean }> {
    if (!this.initialized) {
      throw new Error('ASR is not initialized. Call initialize() first.');
    }
    return this.api.isAsrOnlineEndpoint();
  }

  /**
   * Get the current recognition result from the online stream.
   */
  public async getResult(): Promise<{
    text: string;
    tokens: string[];
    timestamps: number[];
  }> {
    if (!this.initialized) {
      throw new Error('ASR is not initialized. Call initialize() first.');
    }
    return this.api.getAsrOnlineResult();
  }

  /**
   * Signal end-of-input and drain ready frames before reading the final result.
   */
  public async finishInput(): Promise<{ success: boolean; error?: string }> {
    if (!this.initialized) {
      throw new Error('ASR is not initialized. Call initialize() first.');
    }
    return this.api.finishAsrOnlineInput();
  }

  /**
   * Reset the online stream for the next utterance (after endpoint).
   */
  public async resetStream(): Promise<{ success: boolean }> {
    if (!this.initialized) {
      throw new Error('ASR is not initialized. Call initialize() first.');
    }
    return this.api.resetAsrOnlineStream();
  }

  /**
   * Release ASR resources
   */
  public async release(): Promise<{ released: boolean }> {
    const result = await this.api.releaseAsr();
    if (result.released) {
      this.initialized = false;
    }
    return result;
  }
}
