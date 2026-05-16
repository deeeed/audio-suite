import { loadCombinedWasm } from '../wasmLoader';
import { fetchAndDecodeAudio } from '../audioUtils';
import type {
  SpeakerEmbeddingExtractorInstance,
  SpeakerEmbeddingManagerInstance,
} from '../wasmTypes';
import type {
  GetSpeakersResult,
  IdentifySpeakerResult,
  RegisterSpeakerResult,
  RemoveSpeakerResult,
  SpeakerEmbeddingResult,
  SpeakerIdFileProcessResult,
  SpeakerIdFileWindowProcessResult,
  SpeakerIdInitResult,
  SpeakerIdModelConfig,
  SpeakerIdProcessResult,
  VerifySpeakerResult,
} from '../../types/interfaces';
import type {
  WaveformInput,
  RegisterSpeakerInput,
  IdentifySpeakerInput,
  VerifySpeakerInput,
} from '../../types/api';
import { type Constructor, withDownloadProgress } from './mixinUtils';

export function SpeakerIdMixin<TBase extends Constructor>(Base: TBase) {
  return class extends Base {
    public speakerExtractor: SpeakerEmbeddingExtractorInstance | null = null;
    public speakerManager: SpeakerEmbeddingManagerInstance | null = null;
    public speakerIdStream: number | null = null;
    public speakerIdSamplesProcessed = 0;

    async initSpeakerId(
      config: SpeakerIdModelConfig
    ): Promise<SpeakerIdInitResult> {
      try {
        await loadCombinedWasm();

        if (!window.SherpaOnnx.SpeakerId) {
          return {
            success: false,
            embeddingDim: 0,
            error: 'SpeakerId module not loaded',
          };
        }

        const debug = config.debug ? 1 : 0;
        const numThreads = 1; // WASM is single-threaded

        console.log(
          `[SpeakerId] Loading model (threads=${numThreads}, debug=${debug})...`
        );
        // Web-only: config.modelDir is set to '/wasm/speaker-id' by ModelManagement
        // (createWebSpeakerIdModelState in constants.ts), pointing to model files
        // pre-served by download-web-models.sh. Native SpeakerId uses the TurboModule.
        const modelDir = config.modelDir || '/wasm/speaker-id';
        const fetchBase = config.modelBaseUrl || modelDir;

        const loadedModel = await withDownloadProgress(config.onProgress, () =>
          window.SherpaOnnx.SpeakerId!.loadModel({
            model: `${fetchBase}/model.onnx`,
            modelDir,
            debug,
          })
        );

        this.speakerExtractor = window.SherpaOnnx.SpeakerId.createExtractor(
          loadedModel,
          { numThreads, debug }
        );
        const dim = this.speakerExtractor.dim();
        this.speakerManager = window.SherpaOnnx.SpeakerId.createManager(dim);

        console.log(`[SpeakerId] Initialized: dim=${dim}`);
        return { success: true, embeddingDim: dim };
      } catch (error) {
        console.error('[SpeakerId] initSpeakerId failed:', error);
        return {
          success: false,
          embeddingDim: 0,
          error: (error as Error).message,
        };
      }
    }

    async processSpeakerIdSamples({
      sampleRate,
      samples: rawSamples,
    }: WaveformInput): Promise<SpeakerIdProcessResult> {
      if (!this.speakerExtractor) {
        return {
          success: false,
          samplesProcessed: 0,
          error: 'Speaker ID not initialized',
        };
      }
      try {
        if (!this.speakerIdStream) {
          this.speakerIdStream = this.speakerExtractor.createStream();
          this.speakerIdSamplesProcessed = 0;
        }
        const samples = new Float32Array(rawSamples);
        this.speakerExtractor.acceptWaveform(
          this.speakerIdStream,
          sampleRate,
          samples
        );
        this.speakerIdSamplesProcessed += samples.length;
        return {
          success: true,
          samplesProcessed: this.speakerIdSamplesProcessed,
        };
      } catch (error) {
        if (this.speakerExtractor && this.speakerIdStream) {
          this.speakerExtractor.destroyStream(this.speakerIdStream);
          this.speakerIdStream = null;
          this.speakerIdSamplesProcessed = 0;
        }
        return {
          success: false,
          samplesProcessed: 0,
          error: (error as Error).message,
        };
      }
    }

    async computeSpeakerEmbedding(): Promise<SpeakerEmbeddingResult> {
      if (!this.speakerExtractor || !this.speakerIdStream) {
        return {
          success: false,
          embedding: [],
          durationMs: 0,
          embeddingDim: 0,
          error: 'No audio processed',
        };
      }
      try {
        const startMs = performance.now();
        this.speakerExtractor.inputFinished(this.speakerIdStream);

        if (!this.speakerExtractor.isReady(this.speakerIdStream)) {
          this.speakerExtractor.destroyStream(this.speakerIdStream);
          this.speakerIdStream = null;
          this.speakerIdSamplesProcessed = 0;
          return {
            success: false,
            embedding: [],
            durationMs: 0,
            embeddingDim: 0,
            error: 'Not enough audio for embedding',
          };
        }

        const embedding = this.speakerExtractor.computeEmbedding(
          this.speakerIdStream
        );
        const durationMs = performance.now() - startMs;

        // Clean up stream
        this.speakerExtractor.destroyStream(this.speakerIdStream);
        this.speakerIdStream = null;
        this.speakerIdSamplesProcessed = 0;

        return {
          success: true,
          embedding: Array.from(embedding),
          durationMs,
          embeddingDim: embedding.length,
        };
      } catch (error) {
        if (this.speakerExtractor && this.speakerIdStream) {
          this.speakerExtractor.destroyStream(this.speakerIdStream);
          this.speakerIdStream = null;
          this.speakerIdSamplesProcessed = 0;
        }
        return {
          success: false,
          embedding: [],
          durationMs: 0,
          embeddingDim: 0,
          error: (error as Error).message,
        };
      }
    }

    async registerSpeaker({
      name,
      embedding,
    }: RegisterSpeakerInput): Promise<RegisterSpeakerResult> {
      if (!this.speakerManager) {
        return { success: false, error: 'Speaker ID not initialized' };
      }
      const ok = this.speakerManager.add(name, new Float32Array(embedding));
      return {
        success: ok,
        error: ok ? undefined : 'Failed to register speaker',
      };
    }

    async removeSpeaker(name: string): Promise<RemoveSpeakerResult> {
      if (!this.speakerManager) {
        return { success: false, error: 'Speaker ID not initialized' };
      }
      const ok = this.speakerManager.remove(name);
      return { success: ok, error: ok ? undefined : 'Speaker not found' };
    }

    async getSpeakers(): Promise<GetSpeakersResult> {
      if (!this.speakerManager) {
        return {
          success: false,
          speakers: [],
          count: 0,
          error: 'Speaker ID not initialized',
        };
      }
      const speakers = this.speakerManager.getAllSpeakers();
      return { success: true, speakers, count: speakers.length };
    }

    async identifySpeaker({
      embedding,
      threshold,
    }: IdentifySpeakerInput): Promise<IdentifySpeakerResult> {
      if (!this.speakerManager) {
        return {
          success: false,
          speakerName: '',
          identified: false,
          error: 'Speaker ID not initialized',
        };
      }
      const name = this.speakerManager.search(
        new Float32Array(embedding),
        threshold
      );
      return {
        success: true,
        speakerName: name,
        identified: name !== '',
      };
    }

    async verifySpeaker({
      name,
      embedding,
      threshold,
    }: VerifySpeakerInput): Promise<VerifySpeakerResult> {
      if (!this.speakerManager) {
        return {
          success: false,
          verified: false,
          error: 'Speaker ID not initialized',
        };
      }
      const verified = this.speakerManager.verify(
        name,
        new Float32Array(embedding),
        threshold
      );
      return { success: true, verified };
    }

    async processSpeakerIdFile(
      filePath: string
    ): Promise<SpeakerIdFileProcessResult> {
      if (!this.speakerExtractor) {
        return {
          success: false,
          durationMs: 0,
          embedding: [],
          embeddingDim: 0,
          sampleRate: 0,
          samples: 0,
          error: 'Speaker ID not initialized',
        };
      }
      try {
        const startMs = performance.now();
        const { samples, sampleRate } = await fetchAndDecodeAudio(filePath);

        const stream = this.speakerExtractor.createStream();
        this.speakerExtractor.acceptWaveform(stream, sampleRate, samples);
        this.speakerExtractor.inputFinished(stream);

        if (!this.speakerExtractor.isReady(stream)) {
          this.speakerExtractor.destroyStream(stream);
          return {
            success: false,
            durationMs: 0,
            embedding: [],
            embeddingDim: 0,
            sampleRate,
            samples: samples.length,
            error: 'Not enough audio for embedding',
          };
        }

        const embedding = this.speakerExtractor.computeEmbedding(stream);
        this.speakerExtractor.destroyStream(stream);
        const durationMs = performance.now() - startMs;

        return {
          success: true,
          durationMs,
          embedding: Array.from(embedding),
          embeddingDim: embedding.length,
          sampleRate,
          samples: samples.length,
        };
      } catch (error) {
        return {
          success: false,
          durationMs: 0,
          embedding: [],
          embeddingDim: 0,
          sampleRate: 0,
          samples: 0,
          error: (error as Error).message,
        };
      }
    }

    async processSpeakerIdFileWindow({
      filePath,
      startTimeMs,
      durationMs,
    }: {
      filePath: string;
      startTimeMs: number;
      durationMs: number;
    }): Promise<SpeakerIdFileWindowProcessResult> {
      if (!this.speakerExtractor) {
        return {
          success: false,
          durationMs: 0,
          embedding: [],
          embeddingDim: 0,
          sampleRate: 0,
          samples: 0,
          startTimeMs,
          windowDurationMs: durationMs,
          error: 'Speaker ID not initialized',
        };
      }
      try {
        const startMs = performance.now();
        const decoded = await fetchAndDecodeAudio(filePath);
        const startSample = Math.max(
          0,
          Math.floor((startTimeMs / 1000) * decoded.sampleRate)
        );
        const endSample = Math.min(
          decoded.samples.length,
          Math.ceil(((startTimeMs + durationMs) / 1000) * decoded.sampleRate)
        );
        const samples = decoded.samples.slice(startSample, endSample);

        const stream = this.speakerExtractor.createStream();
        this.speakerExtractor.acceptWaveform(stream, decoded.sampleRate, samples);
        this.speakerExtractor.inputFinished(stream);

        if (!this.speakerExtractor.isReady(stream)) {
          this.speakerExtractor.destroyStream(stream);
          return {
            success: false,
            durationMs: 0,
            embedding: [],
            embeddingDim: 0,
            sampleRate: decoded.sampleRate,
            samples: samples.length,
            startTimeMs,
            windowDurationMs: durationMs,
            error: 'Not enough audio for embedding',
          };
        }

        const embedding = this.speakerExtractor.computeEmbedding(stream);
        this.speakerExtractor.destroyStream(stream);
        return {
          success: true,
          durationMs: performance.now() - startMs,
          embedding: Array.from(embedding),
          embeddingDim: embedding.length,
          sampleRate: decoded.sampleRate,
          samples: samples.length,
          startTimeMs,
          windowDurationMs: durationMs,
        };
      } catch (error) {
        return {
          success: false,
          durationMs: 0,
          embedding: [],
          embeddingDim: 0,
          sampleRate: 0,
          samples: 0,
          startTimeMs,
          windowDurationMs: durationMs,
          error: (error as Error).message,
        };
      }
    }

    async releaseSpeakerId(): Promise<{ released: boolean }> {
      if (this.speakerIdStream && this.speakerExtractor) {
        try {
          this.speakerExtractor.destroyStream(this.speakerIdStream);
        } catch (_) {
          console.error('[SpeakerId] releaseSpeakerId stream failed:', _);
        }
        this.speakerIdStream = null;
      }
      if (this.speakerManager) {
        try {
          this.speakerManager.free();
        } catch (_) {
          console.error('[SpeakerId] releaseSpeakerId manager failed:', _);
        }
        this.speakerManager = null;
      }
      if (this.speakerExtractor) {
        try {
          this.speakerExtractor.free();
        } catch (_) {
          console.error('[SpeakerId] releaseSpeakerId extractor failed:', _);
        }
        this.speakerExtractor = null;
      }
      return { released: true };
    }
  };
}
