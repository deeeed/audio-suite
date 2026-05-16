import type {
  TestOnnxIntegrationResult,
  ValidateResult,
  TtsModelConfig,
  TtsInitResult,
  TtsGenerateConfig,
  TtsGenerateResult,
  AsrModelConfig,
  AsrInitResult,
  AsrRecognizeResult,
  AudioTaggingModelConfig,
  AudioTaggingInitResult,
  AudioTaggingResult,
  SpeakerIdModelConfig,
  SpeakerIdInitResult,
  SpeakerIdProcessResult,
  SpeakerEmbeddingResult,
  RegisterSpeakerResult,
  RemoveSpeakerResult,
  GetSpeakersResult,
  IdentifySpeakerResult,
  VerifySpeakerResult,
  SpeakerIdFileProcessResult,
  SpeakerIdFileWindowProcessResult,
  KWSModelConfig,
  KWSInitResult,
  KWSAcceptWaveformResult,
  VadModelConfig,
  VadInitResult,
  VadAcceptWaveformResult,
  LanguageIdModelConfig,
  LanguageIdInitResult,
  LanguageIdResult,
  PunctuationModelConfig,
  PunctuationInitResult,
  PunctuationResult,
  DiarizationModelConfig,
  DiarizationInitResult,
  DiarizationResult,
  DenoiserModelConfig,
  DenoiserInitResult,
  DenoiserResult,
  OnnxSessionConfig,
  OnnxSessionInfo,
  OnnxTensorData,
  OnnxInferenceResult,
} from './interfaces';

export interface ArchitectureInfo {
  architecture: string;
  jsiAvailable: boolean;
  turboModulesEnabled: boolean;
  libraryLoaded: boolean;
  currentThread: string;
  threadId: number;
  moduleType: string;
  error?: string;
}

export interface SystemInfo {
  architecture: {
    type: 'new' | 'old';
    description: string;
    jsiAvailable: boolean;
    turboModulesEnabled: boolean;
    moduleType: string;
  };
  memory: {
    maxMemoryMB: number;
    totalMemoryMB: number;
    freeMemoryMB: number;
    usedMemoryMB: number;
    systemTotalMemoryMB?: number;
    systemAvailableMemoryMB?: number;
    lowMemory?: boolean;
    lowMemoryThresholdMB?: number;
  };
  cpu: {
    availableProcessors: number;
    hardware?: string;
    supportedAbis: string[];
  };
  device: {
    brand: string;
    model: string;
    device: string;
    manufacturer: string;
    sdkVersion?: number; // Optional for non-Android platforms
    androidVersion?: string; // Optional for non-Android platforms
    iosVersion?: string; // Optional for non-iOS platforms
    webPlatform?: string; // Optional for web platform
  };
  gpu: {
    supportsVulkan?: boolean; // Optional as not all platforms support
    vulkanSupported?: boolean;
    openGLESVersion?: string; // Optional as not all platforms use OpenGL
    metalVersion?: string; // Optional for iOS Metal support
    webGLVersion?: string; // Optional for web WebGL support
  };
  libraryLoaded: boolean;
  thread: {
    currentThread: string;
    threadId: number;
  };
  error?: string;
}

// Shared input interfaces
export interface WaveformInput {
  sampleRate: number;
  samples: number[];
}

// Per-feature input interfaces
export interface AudioTaggingFileInput {
  filePath: string;
  topK?: number;
}
export interface AudioTaggingSamplesInput {
  sampleRate: number;
  samples: number[];
  topK?: number;
}
export interface DiarizationFileInput {
  filePath: string;
  numClusters: number;
  threshold: number;
}

export interface SpeakerIdFileWindowInput {
  filePath: string;
  startTimeMs: number;
  durationMs: number;
}
/**
 * Windowed diarization input. iOS currently requires pre-resampled audio
 * matching the diarization model sample rate (16 kHz for the validated pyannote
 * profile). Android resamples during extraction.
 */
export interface DiarizationFileWindowInput extends DiarizationFileInput {
  startTimeMs: number;
  durationMs: number;
}
export interface RegisterSpeakerInput {
  name: string;
  embedding: number[];
}
export interface IdentifySpeakerInput {
  embedding: number[];
  threshold: number;
}
export interface VerifySpeakerInput {
  name: string;
  embedding: number[];
  threshold: number;
}
export interface ExtractTarBz2Input {
  sourcePath: string;
  targetDir: string;
}

export interface ApiInterface {
  // Test methods
  testOnnxIntegration(): Promise<TestOnnxIntegrationResult>;
  validateLibraryLoaded(): Promise<ValidateResult>;
  getArchitectureInfo(): Promise<ArchitectureInfo>;
  getSystemInfo(): Promise<SystemInfo>;

  // TTS methods
  initTts(config: TtsModelConfig): Promise<TtsInitResult>;
  generateTts(config: TtsGenerateConfig): Promise<TtsGenerateResult>;
  stopTts(): Promise<{ stopped: boolean; message?: string }>;
  releaseTts(): Promise<{ released: boolean }>;

  // ASR methods
  initAsr(config: AsrModelConfig): Promise<AsrInitResult>;
  recognizeFromSamples(input: WaveformInput): Promise<AsrRecognizeResult>;
  recognizeFromFile(filePath: string): Promise<AsrRecognizeResult>;
  releaseAsr(): Promise<{ released: boolean }>;

  // ASR online streaming primitives
  createAsrOnlineStream(): Promise<{ success: boolean }>;
  acceptAsrOnlineWaveform(input: WaveformInput): Promise<{ success: boolean }>;
  isAsrOnlineEndpoint(): Promise<{ isEndpoint: boolean }>;
  getAsrOnlineResult(): Promise<{
    text: string;
    tokens: string[];
    timestamps: number[];
  }>;
  resetAsrOnlineStream(): Promise<{ success: boolean }>;

  // Audio tagging methods
  initAudioTagging(
    config: AudioTaggingModelConfig
  ): Promise<AudioTaggingInitResult>;
  processAndComputeAudioTagging(
    input: AudioTaggingFileInput
  ): Promise<AudioTaggingResult>;
  processAndComputeAudioSamples(
    input: AudioTaggingSamplesInput
  ): Promise<AudioTaggingResult>;
  releaseAudioTagging(): Promise<{ released: boolean }>;

  // Speaker ID methods
  initSpeakerId(config: SpeakerIdModelConfig): Promise<SpeakerIdInitResult>;
  processSpeakerIdSamples(input: WaveformInput): Promise<SpeakerIdProcessResult>;
  computeSpeakerEmbedding(): Promise<SpeakerEmbeddingResult>;
  registerSpeaker(input: RegisterSpeakerInput): Promise<RegisterSpeakerResult>;
  removeSpeaker(name: string): Promise<RemoveSpeakerResult>;
  getSpeakers(): Promise<GetSpeakersResult>;
  identifySpeaker(input: IdentifySpeakerInput): Promise<IdentifySpeakerResult>;
  verifySpeaker(input: VerifySpeakerInput): Promise<VerifySpeakerResult>;
  processSpeakerIdFile(filePath: string): Promise<SpeakerIdFileProcessResult>;
  processSpeakerIdFileWindow(input: SpeakerIdFileWindowInput): Promise<SpeakerIdFileWindowProcessResult>;
  releaseSpeakerId(): Promise<{ released: boolean }>;

  // Diarization methods
  initDiarization(config: DiarizationModelConfig): Promise<DiarizationInitResult>;
  processDiarizationFile(input: DiarizationFileInput): Promise<DiarizationResult>;
  processDiarizationFileWindow(input: DiarizationFileWindowInput): Promise<DiarizationResult>;
  releaseDiarization(): Promise<{ released: boolean }>;

  // KWS methods
  initKws(config: KWSModelConfig): Promise<KWSInitResult>;
  acceptKwsWaveform(input: WaveformInput): Promise<KWSAcceptWaveformResult>;
  resetKwsStream(): Promise<{ success: boolean }>;
  releaseKws(): Promise<{ released: boolean }>;

  // VAD methods
  initVad(config: VadModelConfig): Promise<VadInitResult>;
  acceptVadWaveform(input: WaveformInput): Promise<VadAcceptWaveformResult>;
  resetVad(): Promise<{ success: boolean }>;
  releaseVad(): Promise<{ released: boolean }>;

  // Language ID methods
  initLanguageId(config: LanguageIdModelConfig): Promise<LanguageIdInitResult>;
  detectLanguage(input: WaveformInput): Promise<LanguageIdResult>;
  detectLanguageFromFile(filePath: string): Promise<LanguageIdResult>;
  releaseLanguageId(): Promise<{ released: boolean }>;

  // Punctuation methods
  initPunctuation(config: PunctuationModelConfig): Promise<PunctuationInitResult>;
  addPunctuation(text: string): Promise<PunctuationResult>;
  releasePunctuation(): Promise<{ released: boolean }>;

  // Denoising methods
  initDenoiser(config: DenoiserModelConfig): Promise<DenoiserInitResult>;
  denoiseFile(filePath: string): Promise<DenoiserResult>;
  releaseDenoiser(): Promise<{ released: boolean }>;

  // ONNX Inference methods
  createOnnxSession(config: OnnxSessionConfig): Promise<OnnxSessionInfo>;
  runOnnxSession(sessionId: string, inputs: Record<string, OnnxTensorData>): Promise<OnnxInferenceResult>;
  releaseOnnxSession(sessionId: string): Promise<{ released: boolean }>;

  // Archive methods
  extractTarBz2(input: ExtractTarBz2Input): Promise<{
    success: boolean;
    message: string;
    extractedFiles: string[];
  }>;
}
