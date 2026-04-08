import { Platform } from 'react-native';
import type {
  MoonshineAssetModelConfig,
  MoonshineCreateIntentRecognizerConfig,
  MoonshineInitializeResult,
  MoonshineLineWordTiming,
  MoonshineLoadConfigBase,
  MoonshineMemoryModelConfig,
  MoonshineModelConfig,
  MoonshinePlatformStatus,
  MoonshineProcessUtteranceResult,
  MoonshineTranscriptEvent,
  MoonshineTranscriptionResult,
  MoonshineTranscribeOptions,
} from '../types/interfaces';
import {
  normalizeMoonshineWebModelArch,
  resolveMoonshineWebModelBasePath,
  getMoonshineWebRuntimeVersion,
} from '../web/config';
import { MoonshineWebIntentRecognizerModel } from '../web/MoonshineWebIntentRecognizer';
import {
  MoonshineWebModel,
  type MoonshineWebTranscription,
} from '../web/MoonshineWebModel';
import { MoonshineWebSpeakerClusterer } from '../web/MoonshineWebSpeakerClusterer';

type MoonshineListener = (event: MoonshineTranscriptEvent) => void;

type WebTranscriberState = {
  activeStreamHandles: Set<string>;
  config: MoonshineLoadConfigBase;
  defaultStreamId: string;
  dispose?: () => void;
  id: string;
  model: MoonshineWebModel;
  modelBasePath: string;
  nextStreamId: number;
  speakerClusterer: MoonshineWebSpeakerClusterer | null;
  streams: Map<string, WebStreamState>;
  wordTimestampsFailureReason?: string;
};

type WebStreamState = {
  currentLineId: string | null;
  currentLineText: string;
  inFlight: boolean;
  isStarted: boolean;
  lastCompletedAtMs: number;
  lastEmittedText: string;
  lastRequestedAtMs: number;
  lastTranscribedDurationMs: number;
  lineCounter: number;
  lookBehindSamples: number[];
  pendingFinalize: boolean;
  pendingRun: boolean;
  processedDurationMs: number;
  sampleRate: number | null;
  segmentSamples: number[];
  segmentStartedAtMs: number | null;
  silenceDurationMs: number;
  startedEventEmitted: boolean;
  streamId: string;
  transcriberId: string;
};

type WebIntentRecognizerState = {
  id: string;
  intents: Map<string, Float32Array>;
  model: MoonshineWebIntentRecognizerModel;
  threshold: number;
};

function createResult(
  transcriberId: string,
  text: string,
  durationMs: number,
  latencyMs?: number,
  words?: MoonshineLineWordTiming[],
  speakerMetadata?: {
    hasSpeakerId?: boolean;
    speakerId?: string;
    speakerIndex?: number;
  }
): MoonshineTranscriptionResult {
  const normalizedText = text.trim();
  return {
    text: normalizedText,
    lines: normalizedText
      ? [
          {
            completedAtMs: durationMs,
            durationMs,
            isFinal: true,
            lastTranscriptionLatencyMs: latencyMs,
            lineId: `${transcriberId}:line:1`,
            ...speakerMetadata,
            startedAtMs: 0,
            text: normalizedText,
            words,
          },
        ]
      : [],
  };
}

function offsetWords(
  words: MoonshineLineWordTiming[] | undefined,
  offsetMs: number
): MoonshineLineWordTiming[] | undefined {
  if (!words?.length) {
    return undefined;
  }

  return words.map((word) => ({
    ...word,
    endTimeMs:
      word.endTimeMs == null ? word.endTimeMs : word.endTimeMs + offsetMs,
    startTimeMs:
      word.startTimeMs == null ? word.startTimeMs : word.startTimeMs + offsetMs,
  }));
}

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_UPDATE_INTERVAL_MS = 250;
const DEFAULT_VAD_THRESHOLD = 0.008;
const DEFAULT_END_SILENCE_MS = 500;
const DEFAULT_LOOK_BEHIND_SAMPLES = 1600;
const DEFAULT_MAX_SEGMENT_DURATION_MS = 15000;
const DEFAULT_SPEAKER_HINT_MAX_SEGMENT_DURATION_MS = 4000;
const MIN_TRANSCRIBE_SAMPLES = 1600;

function createStreamState(
  transcriberId: string,
  streamId: string
): WebStreamState {
  return {
    currentLineId: null,
    currentLineText: '',
    inFlight: false,
    isStarted: false,
    lastCompletedAtMs: 0,
    lastEmittedText: '',
    lastRequestedAtMs: 0,
    lastTranscribedDurationMs: 0,
    lineCounter: 0,
    lookBehindSamples: [],
    pendingFinalize: false,
    pendingRun: false,
    processedDurationMs: 0,
    sampleRate: null,
    segmentSamples: [],
    segmentStartedAtMs: null,
    silenceDurationMs: 0,
    startedEventEmitted: false,
    streamId,
    transcriberId,
  };
}

function normalizeTranscriptText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function computeRms(samples: number[]): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (const sample of samples) {
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / samples.length);
}

function trimToLastSamples(samples: number[], maxLength: number): number[] {
  if (maxLength <= 0 || samples.length <= maxLength) {
    return samples;
  }
  return samples.slice(samples.length - maxLength);
}

function bytesFromModelPart(part: number[]): Uint8Array {
  const bytes = new Uint8Array(part.length);
  for (let index = 0; index < part.length; index += 1) {
    bytes[index] = part[index] ?? 0;
  }
  return bytes;
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

function getTranscriberOptionValue(
  config: MoonshineLoadConfigBase,
  optionName: string
): string | undefined {
  const option = config.transcriberOptions?.find(
    (candidate) => candidate.name === optionName
  );
  return option ? String(option.value) : undefined;
}

export class MoonshineTranscriber {
  public constructor(
    private readonly service: MoonshineService,
    public readonly transcriberId: string
  ) {}

  public addAudio(
    samples: number[],
    sampleRate: number
  ): Promise<{ success: boolean }> {
    return this.service.addAudioForTranscriber(
      this.transcriberId,
      samples,
      sampleRate
    );
  }

  public addAudioToStream(
    streamId: string,
    samples: number[],
    sampleRate: number
  ): Promise<{ success: boolean }> {
    return this.service.addAudioToStreamForTranscriber(
      this.transcriberId,
      streamId,
      samples,
      sampleRate
    );
  }

  public addListener(listener: MoonshineListener): () => void {
    return this.service.addListener((event) => {
      if (event.transcriberId === this.transcriberId) {
        listener(event);
      }
    });
  }

  public async createStream(): Promise<string> {
    return this.service.createStreamForTranscriber(this.transcriberId);
  }

  public release(): Promise<{ released: boolean }> {
    return this.service.releaseTranscriber(this.transcriberId);
  }

  public removeStream(_streamId: string): Promise<{ success: boolean }> {
    return this.service.removeStreamForTranscriber(
      this.transcriberId,
      _streamId
    );
  }

  public start(): Promise<{ success: boolean }> {
    return this.service.startTranscriber(this.transcriberId);
  }

  public startStream(streamId: string): Promise<{ success: boolean }> {
    return this.service.startStreamForTranscriber(this.transcriberId, streamId);
  }

  public stop(): Promise<{ success: boolean }> {
    return this.service.stopTranscriber(this.transcriberId);
  }

  public stopStream(streamId: string): Promise<{ success: boolean }> {
    return this.service.stopStreamForTranscriber(this.transcriberId, streamId);
  }

  public transcribeFromSamples(
    sampleRate: number,
    samples: number[],
    options?: MoonshineTranscribeOptions
  ): Promise<MoonshineTranscriptionResult> {
    return this.service.transcribeFromSamplesForTranscriber(
      this.transcriberId,
      sampleRate,
      samples,
      options
    );
  }

  public transcribeWithoutStreaming(
    sampleRate: number,
    samples: number[]
  ): Promise<MoonshineTranscriptionResult> {
    return this.service.transcribeWithoutStreamingForTranscriber(
      this.transcriberId,
      sampleRate,
      samples
    );
  }
}

export class MoonshineIntentRecognizer {
  public constructor(
    private readonly service: MoonshineService,
    public readonly intentRecognizerId: string
  ) {}

  public clearIntents(): Promise<{ success: boolean }> {
    return this.service.clearIntents(this.intentRecognizerId);
  }

  public getIntentCount(): Promise<number> {
    return this.service.getIntentCount(this.intentRecognizerId);
  }

  public getIntentThreshold(): Promise<number> {
    return this.service.getIntentThreshold(this.intentRecognizerId);
  }

  public processUtterance(
    utterance: string
  ): Promise<MoonshineProcessUtteranceResult> {
    return this.service.processUtterance(this.intentRecognizerId, utterance);
  }

  public registerIntent(triggerPhrase: string): Promise<{ success: boolean }> {
    return this.service.registerIntent(this.intentRecognizerId, triggerPhrase);
  }

  public release(): Promise<{ success: boolean }> {
    return this.service.releaseIntentRecognizer(this.intentRecognizerId);
  }

  public setIntentThreshold(threshold: number): Promise<{ success: boolean }> {
    return this.service.setIntentThreshold(this.intentRecognizerId, threshold);
  }

  public unregisterIntent(
    triggerPhrase: string
  ): Promise<{ success: boolean }> {
    return this.service.unregisterIntent(
      this.intentRecognizerId,
      triggerPhrase
    );
  }
}

export class MoonshineService {
  private defaultTranscriber: MoonshineTranscriber | null = null;
  private intentModelCache = new Map<
    string,
    MoonshineWebIntentRecognizerModel
  >();
  private nextIntentRecognizerId = 1;
  private readonly intentRecognizers = new Map<
    string,
    WebIntentRecognizerState
  >();
  private listeners = new Set<MoonshineListener>();
  private modelCache = new Map<string, MoonshineWebModel>();
  private nextTranscriberId = 1;
  private readonly transcribers = new Map<string, WebTranscriberState>();

  public addAudio(
    samples: number[],
    sampleRate: number
  ): Promise<{ success: boolean }> {
    return this.ensureDefaultTranscriber().addAudio(samples, sampleRate);
  }

  public addAudioForTranscriber(
    transcriberId: string,
    samples: number[],
    sampleRate: number
  ): Promise<{ success: boolean }> {
    const state = this.getTranscriberState(transcriberId);
    return this.addAudioToStreamState(
      state,
      this.getStreamState(state, state.defaultStreamId),
      samples,
      sampleRate
    );
  }

  public addAudioToStream(
    streamId: string,
    samples: number[],
    sampleRate: number
  ): Promise<{ success: boolean }> {
    return this.ensureDefaultTranscriber().addAudioToStream(
      streamId,
      samples,
      sampleRate
    );
  }

  public addAudioToStreamForTranscriber(
    transcriberId: string,
    streamId: string,
    samples: number[],
    sampleRate: number
  ): Promise<{ success: boolean }> {
    const state = this.getTranscriberState(transcriberId);
    return this.addAudioToStreamState(
      state,
      this.getStreamState(state, streamId),
      samples,
      sampleRate
    );
  }

  public addListener(listener: MoonshineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public clearIntents(
    intentRecognizerId: string
  ): Promise<{ success: boolean }> {
    const state = this.getIntentRecognizerState(intentRecognizerId);
    state.intents.clear();
    return Promise.resolve({ success: true });
  }

  public async createIntentRecognizer(
    config: MoonshineCreateIntentRecognizerConfig
  ): Promise<MoonshineIntentRecognizer> {
    const modelPath = config.modelPath?.trim();
    if (!modelPath) {
      throw new Error('Moonshine intent modelPath is required');
    }

    const modelArch = config.modelArch ?? 'gemma-300m';
    if (!(modelArch === 'gemma-300m' || modelArch === 0)) {
      throw new Error(
        `Unsupported Moonshine web intent modelArch: ${String(modelArch)}`
      );
    }

    const modelVariant = config.modelVariant?.trim() || 'q4';
    const cacheKey = `${modelPath}::${modelVariant}`;
    let model = this.intentModelCache.get(cacheKey);
    if (!model) {
      model = new MoonshineWebIntentRecognizerModel(modelPath, modelVariant);
      this.intentModelCache.set(cacheKey, model);
    }
    await model.load();

    const intentRecognizerId = `web-intent-${this.nextIntentRecognizerId++}`;
    this.intentRecognizers.set(intentRecognizerId, {
      id: intentRecognizerId,
      intents: new Map(),
      model,
      threshold: config.threshold ?? 0.7,
    });
    return new MoonshineIntentRecognizer(this, intentRecognizerId);
  }

  public async createStream(): Promise<string> {
    return this.ensureDefaultTranscriber().createStream();
  }

  public async createStreamForTranscriber(
    transcriberId: string
  ): Promise<string> {
    const state = this.getTranscriberState(transcriberId);
    const streamId = `${transcriberId}:stream:${state.nextStreamId++}`;
    state.streams.set(streamId, createStreamState(transcriberId, streamId));
    state.activeStreamHandles.add(streamId);
    return streamId;
  }

  public async createTranscriberFromAssets(
    config: MoonshineAssetModelConfig
  ): Promise<MoonshineTranscriber> {
    return this.createTranscriberFromResult(
      await this.createWebTranscriber(config, config.assetPath)
    );
  }

  public async createTranscriberFromFiles(
    config: MoonshineModelConfig
  ): Promise<MoonshineTranscriber> {
    return this.createTranscriberFromResult(
      await this.createWebTranscriber(config, config.modelPath)
    );
  }

  public async createTranscriberFromMemory(
    config: MoonshineMemoryModelConfig
  ): Promise<MoonshineTranscriber> {
    return this.createTranscriberFromResult(
      await this.createWebTranscriberFromMemory(config)
    );
  }

  public async errorToString(code: number): Promise<string> {
    return `Moonshine web error ${code}`;
  }

  public async getIntentCount(_intentRecognizerId: string): Promise<number> {
    return this.getIntentRecognizerState(_intentRecognizerId).intents.size;
  }

  public async getIntentThreshold(
    _intentRecognizerId: string
  ): Promise<number> {
    return this.getIntentRecognizerState(_intentRecognizerId).threshold;
  }

  public getPlatformStatus(): MoonshinePlatformStatus {
    return {
      available: true,
      platform: Platform.OS as 'web',
    };
  }

  public async getVersion(): Promise<number> {
    return getMoonshineWebRuntimeVersion();
  }

  public isAvailable(): boolean {
    return true;
  }

  public async initialize(
    config: MoonshineModelConfig
  ): Promise<MoonshineInitializeResult> {
    return this.loadFromFiles(config);
  }

  public async loadFromAssets(
    config: MoonshineAssetModelConfig
  ): Promise<MoonshineInitializeResult> {
    return this.replaceDefaultTranscriberFromResult(
      await this.createWebTranscriber(config, config.assetPath)
    );
  }

  public async loadFromFiles(
    config: MoonshineModelConfig
  ): Promise<MoonshineInitializeResult> {
    return this.replaceDefaultTranscriberFromResult(
      await this.createWebTranscriber(config, config.modelPath)
    );
  }

  public async loadFromMemory(
    config: MoonshineMemoryModelConfig
  ): Promise<MoonshineInitializeResult> {
    return this.replaceDefaultTranscriberFromResult(
      await this.createWebTranscriberFromMemory(config)
    );
  }

  public async release(): Promise<{ released: boolean }> {
    const transcriberId = this.defaultTranscriber?.transcriberId;
    this.defaultTranscriber = null;
    if (!transcriberId) {
      return { released: true };
    }
    return this.releaseTranscriber(transcriberId);
  }

  public async releaseTranscriber(
    transcriberId: string
  ): Promise<{ released: boolean }> {
    const state = this.transcribers.get(transcriberId);
    if (state) {
      for (const stream of state.streams.values()) {
        stream.isStarted = false;
        stream.pendingFinalize = false;
        stream.pendingRun = false;
      }
      state.dispose?.();
      this.transcribers.delete(transcriberId);
    }
    if (this.defaultTranscriber?.transcriberId === transcriberId) {
      this.defaultTranscriber = null;
    }
    return { released: true };
  }

  public releaseIntentRecognizer(
    _intentRecognizerId: string
  ): Promise<{ success: boolean }> {
    this.intentRecognizers.delete(_intentRecognizerId);
    return Promise.resolve({ success: true });
  }

  public removeAllListeners(): void {
    this.listeners.clear();
  }

  public async removeStream(streamId: string): Promise<{ success: boolean }> {
    return this.ensureDefaultTranscriber().removeStream(streamId);
  }

  public removeStreamForTranscriber(
    transcriberId: string,
    streamId: string
  ): Promise<{ success: boolean }> {
    const state = this.getTranscriberState(transcriberId);
    if (streamId === state.defaultStreamId) {
      throw new Error('Moonshine web cannot remove the default stream');
    }
    const stream = this.getStreamState(state, streamId);
    stream.isStarted = false;
    state.streams.delete(streamId);
    state.activeStreamHandles.delete(streamId);
    return Promise.resolve({ success: true });
  }

  public processUtterance(
    _intentRecognizerId: string,
    _utterance: string
  ): Promise<MoonshineProcessUtteranceResult> {
    return this.processUtteranceInternal(_intentRecognizerId, _utterance);
  }

  public registerIntent(
    _intentRecognizerId: string,
    _triggerPhrase: string
  ): Promise<{ success: boolean }> {
    return this.registerIntentInternal(_intentRecognizerId, _triggerPhrase);
  }

  public setIntentThreshold(
    _intentRecognizerId: string,
    _threshold: number
  ): Promise<{ success: boolean }> {
    const state = this.getIntentRecognizerState(_intentRecognizerId);
    state.threshold = _threshold;
    return Promise.resolve({ success: true });
  }

  public async start(): Promise<{ success: boolean }> {
    return this.ensureDefaultTranscriber().start();
  }

  public startTranscriber(
    transcriberId: string
  ): Promise<{ success: boolean }> {
    const state = this.getTranscriberState(transcriberId);
    const stream = this.getStreamState(state, state.defaultStreamId);
    stream.isStarted = true;
    return Promise.resolve({ success: true });
  }

  public async startStream(streamId: string): Promise<{ success: boolean }> {
    return this.ensureDefaultTranscriber().startStream(streamId);
  }

  public startStreamForTranscriber(
    transcriberId: string,
    streamId: string
  ): Promise<{ success: boolean }> {
    const state = this.getTranscriberState(transcriberId);
    const stream = this.getStreamState(state, streamId);
    stream.isStarted = true;
    return Promise.resolve({ success: true });
  }

  public async stop(): Promise<{ success: boolean }> {
    return this.ensureDefaultTranscriber().stop();
  }

  public stopTranscriber(transcriberId: string): Promise<{ success: boolean }> {
    const state = this.getTranscriberState(transcriberId);
    return this.stopStreamInternal(state, state.defaultStreamId);
  }

  public async stopStream(streamId: string): Promise<{ success: boolean }> {
    return this.ensureDefaultTranscriber().stopStream(streamId);
  }

  public stopStreamForTranscriber(
    transcriberId: string,
    streamId: string
  ): Promise<{ success: boolean }> {
    const state = this.getTranscriberState(transcriberId);
    return this.stopStreamInternal(state, streamId);
  }

  public async transcribeFromSamples(
    sampleRate: number,
    samples: number[],
    options?: MoonshineTranscribeOptions
  ): Promise<MoonshineTranscriptionResult> {
    return this.ensureDefaultTranscriber().transcribeFromSamples(
      sampleRate,
      samples,
      options
    );
  }

  public async transcribeFromSamplesForTranscriber(
    transcriberId: string,
    sampleRate: number,
    samples: number[],
    _options?: MoonshineTranscribeOptions
  ): Promise<MoonshineTranscriptionResult> {
    return this.runTranscription(transcriberId, sampleRate, samples);
  }

  public async transcribeWithoutStreaming(
    sampleRate: number,
    samples: number[]
  ): Promise<MoonshineTranscriptionResult> {
    return this.ensureDefaultTranscriber().transcribeWithoutStreaming(
      sampleRate,
      samples
    );
  }

  public async transcribeWithoutStreamingForTranscriber(
    transcriberId: string,
    sampleRate: number,
    samples: number[]
  ): Promise<MoonshineTranscriptionResult> {
    return this.runTranscription(transcriberId, sampleRate, samples);
  }

  public unregisterIntent(
    _intentRecognizerId: string,
    _triggerPhrase: string
  ): Promise<{ success: boolean }> {
    const state = this.getIntentRecognizerState(_intentRecognizerId);
    state.intents.delete(_triggerPhrase);
    return Promise.resolve({ success: true });
  }

  private createTranscriberFromResult(
    result: MoonshineInitializeResult
  ): MoonshineTranscriber {
    if (!result.success || !result.transcriberId) {
      throw new Error(result.error || 'Failed to create Moonshine transcriber');
    }
    return new MoonshineTranscriber(this, result.transcriberId);
  }

  private async createWebTranscriber(
    config: MoonshineLoadConfigBase,
    candidatePath: string | undefined
  ): Promise<MoonshineInitializeResult> {
    try {
      const normalizedArch = normalizeMoonshineWebModelArch(config.modelArch);
      const webEncoderUrl = getTranscriberOptionValue(
        config,
        'web_encoder_url'
      );
      const webDecoderUrl = getTranscriberOptionValue(
        config,
        'web_decoder_url'
      );
      const modelBasePath =
        webEncoderUrl && webDecoderUrl
          ? '[web-url-source]'
          : resolveMoonshineWebModelBasePath(candidatePath, normalizedArch);
      const stateId = `web-transcriber-${this.nextTranscriberId++}`;
      const wordTimestampsRequested = config.options?.wordTimestamps === true;
      const cacheKey = `${normalizedArch}::${webEncoderUrl ?? modelBasePath}::${webDecoderUrl ?? modelBasePath}::wordTimestamps=${wordTimestampsRequested ? '1' : '0'}`;
      let model = this.modelCache.get(cacheKey);
      if (!model) {
        model = new MoonshineWebModel(
          normalizedArch,
          webEncoderUrl && webDecoderUrl
            ? {
                decoderUrl: webDecoderUrl,
                encoderUrl: webEncoderUrl,
                kind: 'urls',
              }
            : {
                kind: 'path',
                modelBasePath,
              },
          { wordTimestamps: wordTimestampsRequested }
        );
        this.modelCache.set(cacheKey, model);
      }
      await model.load();
      const defaultStreamId = `${stateId}:default`;
      this.transcribers.set(stateId, {
        activeStreamHandles: new Set([defaultStreamId]),
        config,
        defaultStreamId,
        id: stateId,
        model,
        modelBasePath,
        nextStreamId: 1,
        speakerClusterer: config.options?.identifySpeakers
          ? new MoonshineWebSpeakerClusterer(
              config.options.speakerIdClusterThreshold
            )
          : null,
        streams: new Map([
          [defaultStreamId, createStreamState(stateId, defaultStreamId)],
        ]),
        wordTimestampsFailureReason: model.getWordTimestampsFailureReason(),
      });
      return {
        success: true,
        transcriberId: stateId,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        success: false,
      };
    }
  }

  private async createWebTranscriberFromMemory(
    config: MoonshineMemoryModelConfig
  ): Promise<MoonshineInitializeResult> {
    let encoderUrl: string | null = null;
    let decoderUrl: string | null = null;

    try {
      if (config.modelData.length !== 3) {
        throw new Error(
          'Moonshine web modelData must contain exactly 3 binary parts'
        );
      }

      const normalizedArch = normalizeMoonshineWebModelArch(config.modelArch);
      const encoderBytes = bytesFromModelPart(config.modelData[0]);
      const decoderBytes = bytesFromModelPart(config.modelData[1]);

      encoderUrl = URL.createObjectURL(
        new Blob([arrayBufferFromBytes(encoderBytes)], {
          type: 'application/octet-stream',
        })
      );
      decoderUrl = URL.createObjectURL(
        new Blob([arrayBufferFromBytes(decoderBytes)], {
          type: 'application/octet-stream',
        })
      );

      const stateId = `web-transcriber-${this.nextTranscriberId++}`;
      const model = new MoonshineWebModel(
        normalizedArch,
        {
          decoderUrl,
          encoderUrl,
          kind: 'urls',
        },
        { wordTimestamps: config.options?.wordTimestamps === true }
      );
      await model.load();

      // The native in-memory API includes tokenizer bytes as the third part.
      // The current browser backend uses llama-tokenizer-js and does not need
      // that blob, but we still validate the same 3-part contract for parity.
      const defaultStreamId = `${stateId}:default`;
      this.transcribers.set(stateId, {
        activeStreamHandles: new Set([defaultStreamId]),
        config,
        defaultStreamId,
        dispose: () => {
          if (encoderUrl) URL.revokeObjectURL(encoderUrl);
          if (decoderUrl) URL.revokeObjectURL(decoderUrl);
        },
        id: stateId,
        model,
        modelBasePath: '[memory]',
        nextStreamId: 1,
        speakerClusterer: config.options?.identifySpeakers
          ? new MoonshineWebSpeakerClusterer(
              config.options.speakerIdClusterThreshold
            )
          : null,
        streams: new Map([
          [defaultStreamId, createStreamState(stateId, defaultStreamId)],
        ]),
        wordTimestampsFailureReason: model.getWordTimestampsFailureReason(),
      });
      return {
        success: true,
        transcriberId: stateId,
      };
    } catch (error) {
      if (encoderUrl) URL.revokeObjectURL(encoderUrl);
      if (decoderUrl) URL.revokeObjectURL(decoderUrl);
      return {
        error: error instanceof Error ? error.message : String(error),
        success: false,
      };
    }
  }

  private emit(event: MoonshineTranscriptEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private emitOfflineResultEvents(
    transcriberId: string,
    result: MoonshineTranscriptionResult
  ): void {
    const streamId = `${transcriberId}:default`;
    for (const line of result.lines) {
      this.emit({
        line: {
          ...line,
          isFinal: false,
          isNew: true,
        },
        streamId,
        transcriberId,
        type: 'lineStarted',
      });
      if ((line.text || '').length > 0) {
        this.emit({
          line: {
            ...line,
            hasTextChanged: true,
            isFinal: false,
            isUpdated: true,
          },
          streamId,
          transcriberId,
          type: 'lineTextChanged',
        });
      }
      this.emit({
        line: {
          ...line,
          isFinal: true,
          isUpdated: true,
        },
        streamId,
        transcriberId,
        type: 'lineCompleted',
      });
    }
  }

  private getIntentRecognizerState(
    intentRecognizerId: string
  ): WebIntentRecognizerState {
    const state = this.intentRecognizers.get(intentRecognizerId);
    if (!state) {
      throw new Error(
        `Moonshine web intent recognizer "${intentRecognizerId}" does not exist`
      );
    }
    return state;
  }

  private ensureDefaultTranscriber(): MoonshineTranscriber {
    if (!this.defaultTranscriber) {
      throw new Error(
        'Moonshine default transcriber is not initialized. Call loadFromFiles() or loadFromAssets() first.'
      );
    }
    return this.defaultTranscriber;
  }

  private getTranscriberState(transcriberId: string): WebTranscriberState {
    const state = this.transcribers.get(transcriberId);
    if (!state) {
      throw new Error(
        `Moonshine web transcriber "${transcriberId}" does not exist`
      );
    }
    return state;
  }

  private async processUtteranceInternal(
    intentRecognizerId: string,
    utterance: string
  ): Promise<MoonshineProcessUtteranceResult> {
    const normalizedUtterance = utterance.trim();
    if (!normalizedUtterance) {
      throw new Error('Moonshine utterance is required');
    }

    const state = this.getIntentRecognizerState(intentRecognizerId);
    if (state.intents.size === 0) {
      return { matched: false, success: true };
    }

    const utteranceEmbedding =
      await state.model.getEmbedding(normalizedUtterance);
    let bestTriggerPhrase: string | null = null;
    let bestSimilarity = Number.NEGATIVE_INFINITY;

    for (const [triggerPhrase, intentEmbedding] of state.intents.entries()) {
      const similarity = state.model.similarity(
        utteranceEmbedding,
        intentEmbedding
      );
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestTriggerPhrase = triggerPhrase;
      }
    }

    if (bestTriggerPhrase && bestSimilarity >= state.threshold) {
      return {
        match: {
          similarity: bestSimilarity,
          triggerPhrase: bestTriggerPhrase,
          utterance: normalizedUtterance,
        },
        matched: true,
        success: true,
      };
    }

    return { matched: false, success: true };
  }

  private async registerIntentInternal(
    intentRecognizerId: string,
    triggerPhrase: string
  ): Promise<{ success: boolean }> {
    const normalizedTriggerPhrase = triggerPhrase.trim();
    if (!normalizedTriggerPhrase) {
      throw new Error('Moonshine intent triggerPhrase is required');
    }

    const state = this.getIntentRecognizerState(intentRecognizerId);
    const embedding = await state.model.getEmbedding(normalizedTriggerPhrase);
    state.intents.set(normalizedTriggerPhrase, embedding);
    return { success: true };
  }

  private async replaceDefaultTranscriberFromResult(
    result: MoonshineInitializeResult
  ): Promise<MoonshineInitializeResult> {
    if (!result.success || !result.transcriberId) {
      return result;
    }

    const previousDefaultTranscriberId = this.defaultTranscriber?.transcriberId;
    this.defaultTranscriber = new MoonshineTranscriber(
      this,
      result.transcriberId
    );

    if (
      previousDefaultTranscriberId &&
      previousDefaultTranscriberId !== result.transcriberId
    ) {
      await this.releaseTranscriber(previousDefaultTranscriberId);
    }

    return result;
  }

  private async runTranscription(
    transcriberId: string,
    sampleRate: number,
    samples: number[]
  ): Promise<MoonshineTranscriptionResult> {
    if (sampleRate !== DEFAULT_SAMPLE_RATE) {
      throw new Error(
        `Moonshine web currently expects ${DEFAULT_SAMPLE_RATE}Hz mono PCM. Received sample rate: ${sampleRate}`
      );
    }

    const state = this.getTranscriberState(transcriberId);
    const durationMs = (samples.length / sampleRate) * 1000;
    const transcription: MoonshineWebTranscription =
      await state.model.transcribeDetailed(Float32Array.from(samples), {
        wordTimestamps: state.config.options?.wordTimestamps,
      });
    const text = transcription.text;
    const speakerMetadata =
      text && state.speakerClusterer
        ? state.speakerClusterer.assign(samples, sampleRate)
        : undefined;
    const result = createResult(
      transcriberId,
      text,
      durationMs,
      state.model.getLatency(),
      transcription.words,
      speakerMetadata
    );

    if (result.lines[0]) {
      this.emitOfflineResultEvents(transcriberId, result);
    }

    return result;
  }

  private getStreamState(
    transcriber: WebTranscriberState,
    streamId: string
  ): WebStreamState {
    const stream = transcriber.streams.get(streamId);
    if (!stream || !transcriber.activeStreamHandles.has(streamId)) {
      throw new Error(
        `Moonshine web stream "${streamId}" does not exist for transcriber "${transcriber.id}"`
      );
    }
    return stream;
  }

  private async addAudioToStreamState(
    transcriber: WebTranscriberState,
    stream: WebStreamState,
    samples: number[],
    sampleRate: number
  ): Promise<{ success: boolean }> {
    if (!stream.isStarted) {
      throw new Error(
        `Moonshine web stream "${stream.streamId}" is not started. Call start() first.`
      );
    }
    if (sampleRate !== DEFAULT_SAMPLE_RATE) {
      throw new Error(
        `Moonshine web currently expects ${DEFAULT_SAMPLE_RATE}Hz mono PCM. Received sample rate: ${sampleRate}`
      );
    }
    if (samples.length === 0) {
      return { success: true };
    }

    stream.sampleRate = sampleRate;
    const chunkDurationMs = (samples.length / sampleRate) * 1000;
    const rms = computeRms(samples);
    const options = transcriber.config.options;
    const vadThreshold = options?.vadThreshold ?? DEFAULT_VAD_THRESHOLD;
    const endSilenceMs = DEFAULT_END_SILENCE_MS;
    const lookBehindSampleCount = Math.max(
      0,
      options?.vadLookBehindSampleCount ?? DEFAULT_LOOK_BEHIND_SAMPLES
    );
    // Shorter segments give the experimental web speaker clusterer more
    // speaker-pure audio to work with than the normal long streaming turns.
    const defaultMaxSegmentDurationMs = options?.identifySpeakers
      ? DEFAULT_SPEAKER_HINT_MAX_SEGMENT_DURATION_MS
      : DEFAULT_MAX_SEGMENT_DURATION_MS;
    const maxSegmentDurationMs = Math.max(
      1000,
      options?.vadMaxSegmentDurationMs ?? defaultMaxSegmentDurationMs
    );
    const isSpeechChunk =
      rms >= vadThreshold ||
      (stream.currentLineId != null && rms >= vadThreshold * 0.5);
    const previousLookBehind = stream.lookBehindSamples;

    if (isSpeechChunk) {
      if (!stream.currentLineId) {
        stream.lineCounter += 1;
        stream.currentLineId = `${stream.streamId}:line:${stream.lineCounter}`;
        stream.currentLineText = '';
        stream.lastEmittedText = '';
        stream.startedEventEmitted = false;
        stream.segmentStartedAtMs = Math.max(
          0,
          stream.processedDurationMs -
            (previousLookBehind.length / sampleRate) * 1000
        );
        stream.segmentSamples = [...previousLookBehind, ...samples];
      } else {
        stream.segmentSamples.push(...samples);
      }
      stream.silenceDurationMs = 0;
      const updateIntervalMs =
        transcriber.config.updateIntervalMs ?? DEFAULT_UPDATE_INTERVAL_MS;
      if (
        stream.pendingFinalize ||
        stream.processedDurationMs - stream.lastRequestedAtMs >=
          updateIntervalMs
      ) {
        stream.pendingRun = true;
        stream.lastRequestedAtMs = stream.processedDurationMs;
      }
    } else if (stream.currentLineId) {
      stream.segmentSamples.push(...samples);
      stream.silenceDurationMs += chunkDurationMs;
      if (stream.silenceDurationMs >= endSilenceMs) {
        stream.pendingFinalize = true;
        stream.pendingRun = true;
        stream.lastRequestedAtMs = stream.processedDurationMs;
      }
    }

    stream.lookBehindSamples = trimToLastSamples(
      [...previousLookBehind, ...samples],
      lookBehindSampleCount
    );

    stream.processedDurationMs += chunkDurationMs;

    if (
      stream.currentLineId &&
      stream.segmentStartedAtMs != null &&
      stream.processedDurationMs - stream.segmentStartedAtMs >=
        maxSegmentDurationMs
    ) {
      stream.pendingFinalize = true;
    }

    this.scheduleStreamTranscription(transcriber, stream);
    return { success: true };
  }

  private scheduleStreamTranscription(
    transcriber: WebTranscriberState,
    stream: WebStreamState
  ): void {
    if (stream.inFlight || !stream.currentLineId) {
      return;
    }
    stream.inFlight = true;
    // eslint-disable-next-line no-void
    void this.runQueuedStreamTranscription(transcriber, stream).finally(() => {
      stream.inFlight = false;
      if (stream.pendingRun || stream.pendingFinalize) {
        this.scheduleStreamTranscription(transcriber, stream);
      }
    });
  }

  private async runQueuedStreamTranscription(
    transcriber: WebTranscriberState,
    stream: WebStreamState
  ): Promise<void> {
    while (
      transcriber.activeStreamHandles.has(stream.streamId) &&
      stream.currentLineId &&
      (stream.pendingRun || stream.pendingFinalize)
    ) {
      stream.pendingRun = false;
      const lineId = stream.currentLineId;
      const sampleRate = stream.sampleRate ?? DEFAULT_SAMPLE_RATE;
      const durationMs = (stream.segmentSamples.length / sampleRate) * 1000;
      if (stream.segmentSamples.length < MIN_TRANSCRIBE_SAMPLES) {
        if (stream.pendingFinalize) {
          this.resetCurrentLine(stream);
        }
        continue;
      }

      const shouldFinalize = stream.pendingFinalize;
      stream.pendingFinalize = false;
      const snapshotSamples = Float32Array.from(stream.segmentSamples);
      const startedAtMs =
        stream.segmentStartedAtMs ??
        Math.max(0, stream.processedDurationMs - durationMs);

      try {
        const transcription = await transcriber.model.transcribeDetailed(
          snapshotSamples,
          { wordTimestamps: transcriber.config.options?.wordTimestamps }
        );
        const text = normalizeTranscriptText(transcription.text);
        if (stream.currentLineId !== lineId) {
          continue;
        }

        const latencyMs = transcriber.model.getLatency();
        const completedAtMs = Math.max(startedAtMs, startedAtMs + durationMs);
        const speakerMetadata =
          shouldFinalize && text && transcriber.speakerClusterer
            ? transcriber.speakerClusterer.assign(snapshotSamples, sampleRate)
            : undefined;
        const baseLine = {
          audioData:
            shouldFinalize && transcriber.config.includeAudioData
              ? Array.from(snapshotSamples)
              : undefined,
          completedAtMs: shouldFinalize ? completedAtMs : undefined,
          durationMs,
          isFinal: shouldFinalize,
          lastTranscriptionLatencyMs: latencyMs,
          lineId,
          ...speakerMetadata,
          startedAtMs,
          text,
          words: offsetWords(transcription.words, startedAtMs),
        };

        if (text) {
          if (!stream.startedEventEmitted) {
            stream.startedEventEmitted = true;
            this.emit({
              line: {
                ...baseLine,
                isFinal: false,
                isNew: true,
              },
              streamId: stream.streamId,
              transcriberId: transcriber.id,
              type: 'lineStarted',
            });
          } else {
            this.emit({
              line: {
                ...baseLine,
                hasTextChanged: text !== stream.lastEmittedText,
                isFinal: false,
                isUpdated: true,
              },
              streamId: stream.streamId,
              transcriberId: transcriber.id,
              type: 'lineUpdated',
            });
          }

          if (text !== stream.lastEmittedText) {
            this.emit({
              line: {
                ...baseLine,
                hasTextChanged: true,
                isFinal: false,
                isUpdated: stream.startedEventEmitted,
              },
              streamId: stream.streamId,
              transcriberId: transcriber.id,
              type: 'lineTextChanged',
            });
          }

          stream.currentLineText = text;
          stream.lastEmittedText = text;
          stream.lastTranscribedDurationMs = durationMs;
        }

        if (shouldFinalize) {
          if (text) {
            this.emit({
              line: {
                ...baseLine,
                completedAtMs,
                isFinal: true,
              },
              streamId: stream.streamId,
              transcriberId: transcriber.id,
              type: 'lineCompleted',
            });
          }
          stream.lastCompletedAtMs = completedAtMs;
          this.resetCurrentLine(stream);
        }
      } catch (error) {
        this.emit({
          error: error instanceof Error ? error.message : String(error),
          streamId: stream.streamId,
          transcriberId: transcriber.id,
          type: 'error',
        });
        if (shouldFinalize) {
          this.resetCurrentLine(stream);
        }
      }
    }
  }

  private resetCurrentLine(stream: WebStreamState): void {
    stream.currentLineId = null;
    stream.currentLineText = '';
    stream.lastEmittedText = '';
    stream.lastRequestedAtMs = 0;
    stream.segmentSamples = [];
    stream.segmentStartedAtMs = null;
    stream.silenceDurationMs = 0;
    stream.startedEventEmitted = false;
    stream.pendingFinalize = false;
    stream.pendingRun = false;
    stream.lastTranscribedDurationMs = 0;
  }

  private async stopStreamInternal(
    transcriber: WebTranscriberState,
    streamId: string
  ): Promise<{ success: boolean }> {
    const stream = this.getStreamState(transcriber, streamId);
    stream.isStarted = false;
    if (stream.currentLineId && stream.segmentSamples.length > 0) {
      stream.pendingRun = true;
      stream.pendingFinalize = true;
      this.scheduleStreamTranscription(transcriber, stream);
      const startedAt = Date.now();
      const maxWaitMs = 5000;
      while (stream.inFlight || stream.pendingRun || stream.pendingFinalize) {
        if (Date.now() - startedAt > maxWaitMs) {
          throw new Error(
            `Moonshine web stopStream timed out while waiting for stream "${streamId}" to flush`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    return { success: true };
  }
}
