import type {
  ApiInterface,
  ArchitectureInfo,
  SystemInfo,
  WaveformInput,
  AudioTaggingFileInput,
  AudioTaggingSamplesInput,
  DiarizationFileInput,
  DiarizationFileWindowInput,
  SpeakerIdFileWindowInput,
  RegisterSpeakerInput,
  IdentifySpeakerInput,
  VerifySpeakerInput,
  ExtractTarBz2Input,
} from './types/api';
import type {
  AsrInitResult,
  AsrModelConfig,
  AsrRecognizeResult,
  AudioTaggingInitResult,
  AudioTaggingModelConfig,
  AudioTaggingResult,
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
  TestOnnxIntegrationResult,
  TtsGenerateConfig,
  TtsGenerateResult,
  TtsInitResult,
  TtsModelConfig,
  ValidateResult,
  VerifySpeakerResult,
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
} from './types/interfaces';

// Import the native module and potentially substitute with web implementation
import { Platform } from 'react-native';
import NativeModuleImport from './NativeSherpaOnnxSpec';
import { WebSherpaOnnxImpl } from './WebSherpaOnnxImpl';

// On web, WebSherpaOnnxImpl already implements ApiInterface directly (object params).
// On native, NativeModuleImport uses positional args — SherpaOnnxAPI adapts them below.
const webImpl: ApiInterface | null =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Platform.OS === 'web' ? (new WebSherpaOnnxImpl() as any) : null;

// NativeSherpaOnnx is only used on native (positional-arg TurboModule interface).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NativeSherpaOnnx = NativeModuleImport as any;

// Log a warning if the native module is missing on a native platform
if (!NativeModuleImport && Platform.OS !== 'web') {
  console.warn(
    'SherpaOnnx native module not available on this platform'
  );
}

/**
 * Implementation of the SherpaOnnx API
 * On web: delegates directly to WebSherpaOnnxImpl (which already implements ApiInterface).
 * On native: adapts positional-arg TurboModule calls to the object-param ApiInterface.
 */
const nativeAdapter: ApiInterface = {
  testOnnxIntegration(): Promise<TestOnnxIntegrationResult> {
    return NativeSherpaOnnx.testOnnxIntegration();
  },

  validateLibraryLoaded(): Promise<ValidateResult> {
    return NativeSherpaOnnx.validateLibraryLoaded();
  },

  getArchitectureInfo(): Promise<ArchitectureInfo> {
    return NativeSherpaOnnx.getArchitectureInfo();
  },
  
  getSystemInfo(): Promise<SystemInfo> {
    return NativeSherpaOnnx.getSystemInfo();
  },

  /**
   * Initialize the TTS engine with the provided model configuration
   * @param config Configuration for the TTS model
   * @returns Promise that resolves with initialization result
   */
  initTts(config: TtsModelConfig): Promise<TtsInitResult> {
    return NativeSherpaOnnx.initTts(config);
  },

  generateTts(config: TtsGenerateConfig): Promise<TtsGenerateResult> {
    return NativeSherpaOnnx.generateTts(config);
  },

  stopTts(): Promise<{ stopped: boolean; message?: string }> {
    return NativeSherpaOnnx.stopTts();
  },

  releaseTts(): Promise<{ released: boolean }> {
    return NativeSherpaOnnx.releaseTts();
  },

  // ASR methods
  initAsr(config: AsrModelConfig): Promise<AsrInitResult> {
    // Flatten modelFiles into top-level keys for TurboModule compatibility
    const nativeConfig: Record<string, unknown> = {
      modelDir: config.modelDir,
      modelType: config.modelType,
      numThreads: config.numThreads,
      debug: config.debug,
      streaming: config.streaming,
      decodingMethod: config.decodingMethod,
      maxActivePaths: config.maxActivePaths,
      provider: config.provider,
      language: config.language,
      task: config.task,
      useItn: config.useItn,
      srcLang: config.srcLang,
      tgtLang: config.tgtLang,
      usePnc: config.usePnc,
      usePunct: config.usePunct,
      hotwords: config.hotwords,
    };
    if (config.modelFiles) {
      nativeConfig.modelFileEncoder = config.modelFiles.encoder;
      nativeConfig.modelFileDecoder = config.modelFiles.decoder;
      nativeConfig.modelFileJoiner = config.modelFiles.joiner;
      nativeConfig.modelFileTokens = config.modelFiles.tokens;
      nativeConfig.modelFileModel = config.modelFiles.model;
      nativeConfig.modelFilePreprocessor = config.modelFiles.preprocessor;
      nativeConfig.modelFileUncachedDecoder = config.modelFiles.uncachedDecoder;
      nativeConfig.modelFileCachedDecoder = config.modelFiles.cachedDecoder;
      nativeConfig.modelFileMergedDecoder = config.modelFiles.mergedDecoder;
      nativeConfig.modelFileConvFrontend = config.modelFiles.convFrontend;
      nativeConfig.modelFileTokenizer = config.modelFiles.tokenizer;
    }
    if (config.qwen3) {
      nativeConfig.qwen3MaxTotalLen = config.qwen3.maxTotalLen;
      nativeConfig.qwen3MaxNewTokens = config.qwen3.maxNewTokens;
      nativeConfig.qwen3Temperature = config.qwen3.temperature;
      nativeConfig.qwen3TopP = config.qwen3.topP;
      nativeConfig.qwen3Seed = config.qwen3.seed;
    }
    return NativeSherpaOnnx.initAsr(nativeConfig as any);
  },

  recognizeFromSamples({ sampleRate, samples }: WaveformInput): Promise<AsrRecognizeResult> {
    return NativeSherpaOnnx.recognizeFromSamples(sampleRate, samples);
  },

  recognizeFromFile(filePath: string): Promise<AsrRecognizeResult> {
    return NativeSherpaOnnx.recognizeFromFile(filePath);
  },

  releaseAsr(): Promise<{ released: boolean }> {
    return NativeSherpaOnnx.releaseAsr();
  },

  // ASR online streaming primitives
  createAsrOnlineStream(): Promise<{ success: boolean }> {
    return NativeSherpaOnnx.createAsrOnlineStream();
  },

  acceptAsrOnlineWaveform({ sampleRate, samples }: WaveformInput): Promise<{ success: boolean }> {
    return NativeSherpaOnnx.acceptAsrOnlineWaveform(sampleRate, samples);
  },

  isAsrOnlineEndpoint(): Promise<{ isEndpoint: boolean }> {
    return NativeSherpaOnnx.isAsrOnlineEndpoint();
  },

  getAsrOnlineResult(): Promise<{
    text: string;
    tokens: string[];
    timestamps: number[];
  }> {
    return NativeSherpaOnnx.getAsrOnlineResult();
  },

  finishAsrOnlineInput(): Promise<{ success: boolean; error?: string }> {
    return NativeSherpaOnnx.finishAsrOnlineInput();
  },

  resetAsrOnlineStream(): Promise<{ success: boolean }> {
    return NativeSherpaOnnx.resetAsrOnlineStream();
  },

  // Audio tagging methods
  initAudioTagging(
    config: AudioTaggingModelConfig
  ): Promise<AudioTaggingInitResult> {
    return NativeSherpaOnnx.initAudioTagging(config as any);
  },

  processAndComputeAudioTagging({ filePath }: AudioTaggingFileInput): Promise<AudioTaggingResult> {
    return NativeSherpaOnnx.processAndComputeAudioTagging(filePath);
  },

  processAndComputeAudioSamples({ sampleRate, samples }: AudioTaggingSamplesInput): Promise<AudioTaggingResult> {
    return NativeSherpaOnnx.processAndComputeAudioSamples(sampleRate, samples);
  },

  releaseAudioTagging(): Promise<{ released: boolean }> {
    return NativeSherpaOnnx.releaseAudioTagging();
  },

  // Speaker ID methods
  initSpeakerId(config: SpeakerIdModelConfig): Promise<SpeakerIdInitResult> {
    return NativeSherpaOnnx.initSpeakerId(config as any);
  },

  processSpeakerIdSamples({ sampleRate, samples }: WaveformInput): Promise<SpeakerIdProcessResult> {
    return NativeSherpaOnnx.processSpeakerIdSamples(sampleRate, samples);
  },

  computeSpeakerEmbedding(): Promise<SpeakerEmbeddingResult> {
    return NativeSherpaOnnx.computeSpeakerEmbedding();
  },

  resetSpeakerIdStream(): Promise<{ success: boolean }> {
    return NativeSherpaOnnx.resetSpeakerIdStream();
  },

  registerSpeaker({ name, embedding }: RegisterSpeakerInput): Promise<RegisterSpeakerResult> {
    return NativeSherpaOnnx.registerSpeaker(name, embedding);
  },

  removeSpeaker(name: string): Promise<RemoveSpeakerResult> {
    return NativeSherpaOnnx.removeSpeaker(name);
  },

  getSpeakers(): Promise<GetSpeakersResult> {
    return NativeSherpaOnnx.getSpeakers();
  },

  identifySpeaker({ embedding, threshold }: IdentifySpeakerInput): Promise<IdentifySpeakerResult> {
    return NativeSherpaOnnx.identifySpeaker(embedding, threshold);
  },

  verifySpeaker({ name, embedding, threshold }: VerifySpeakerInput): Promise<VerifySpeakerResult> {
    return NativeSherpaOnnx.verifySpeaker(name, embedding, threshold);
  },

  processSpeakerIdFile(filePath: string): Promise<SpeakerIdFileProcessResult> {
    return NativeSherpaOnnx.processSpeakerIdFile(filePath);
  },

  processSpeakerIdFileWindow({
    filePath,
    startTimeMs,
    durationMs,
  }: SpeakerIdFileWindowInput): Promise<SpeakerIdFileWindowProcessResult> {
    return NativeSherpaOnnx.processSpeakerIdFileWindow(filePath, startTimeMs, durationMs);
  },

  releaseSpeakerId(): Promise<{ released: boolean }> {
    return NativeSherpaOnnx.releaseSpeakerId();
  },

  // Diarization methods
  initDiarization(config: DiarizationModelConfig): Promise<DiarizationInitResult> {
    return NativeSherpaOnnx.initDiarization(config as any);
  },

  processDiarizationFile({ filePath, numClusters, threshold }: DiarizationFileInput): Promise<DiarizationResult> {
    return NativeSherpaOnnx.processDiarizationFile(filePath, numClusters, threshold);
  },

  processDiarizationFileWindow({
    filePath,
    startTimeMs,
    durationMs,
    numClusters,
    threshold,
  }: DiarizationFileWindowInput): Promise<DiarizationResult> {
    return NativeSherpaOnnx.processDiarizationFileWindow(
      filePath,
      startTimeMs,
      durationMs,
      numClusters,
      threshold
    );
  },

  releaseDiarization(): Promise<{ released: boolean }> {
    return NativeSherpaOnnx.releaseDiarization();
  },

  // KWS methods
  initKws(config: KWSModelConfig): Promise<KWSInitResult> {
    return NativeSherpaOnnx.initKws(config as any);
  },

  acceptKwsWaveform({ sampleRate, samples }: WaveformInput): Promise<KWSAcceptWaveformResult> {
    return NativeSherpaOnnx.acceptKwsWaveform(sampleRate, samples);
  },

  resetKwsStream(): Promise<{ success: boolean }> {
    return NativeSherpaOnnx.resetKwsStream();
  },

  releaseKws(): Promise<{ released: boolean }> {
    return NativeSherpaOnnx.releaseKws();
  },

  // VAD methods
  initVad(config: VadModelConfig): Promise<VadInitResult> {
    return NativeSherpaOnnx.initVad(config as any);
  },

  acceptVadWaveform({ sampleRate, samples }: WaveformInput): Promise<VadAcceptWaveformResult> {
    return NativeSherpaOnnx.acceptVadWaveform(sampleRate, samples);
  },

  resetVad(): Promise<{ success: boolean }> {
    return NativeSherpaOnnx.resetVad();
  },

  releaseVad(): Promise<{ released: boolean }> {
    return NativeSherpaOnnx.releaseVad();
  },

  // Language ID methods
  initLanguageId(config: LanguageIdModelConfig): Promise<LanguageIdInitResult> {
    return NativeSherpaOnnx.initLanguageId(config as any);
  },

  detectLanguage({ sampleRate, samples }: WaveformInput): Promise<LanguageIdResult> {
    return NativeSherpaOnnx.detectLanguage(sampleRate, samples);
  },

  detectLanguageFromFile(filePath: string): Promise<LanguageIdResult> {
    return NativeSherpaOnnx.detectLanguageFromFile(filePath);
  },

  releaseLanguageId(): Promise<{ released: boolean }> {
    return NativeSherpaOnnx.releaseLanguageId();
  },

  // Punctuation methods
  initPunctuation(config: PunctuationModelConfig): Promise<PunctuationInitResult> {
    return NativeSherpaOnnx.initPunctuation(config as any);
  },

  addPunctuation(text: string): Promise<PunctuationResult> {
    return NativeSherpaOnnx.addPunctuation(text);
  },

  releasePunctuation(): Promise<{ released: boolean }> {
    return NativeSherpaOnnx.releasePunctuation();
  },

  // Denoising methods
  initDenoiser(config: DenoiserModelConfig): Promise<DenoiserInitResult> {
    return NativeSherpaOnnx.initDenoiser(config as any);
  },

  denoiseFile(filePath: string): Promise<DenoiserResult> {
    return NativeSherpaOnnx.denoiseFile(filePath);
  },

  releaseDenoiser(): Promise<{ released: boolean }> {
    return NativeSherpaOnnx.releaseDenoiser();
  },

  // ONNX Inference methods
  createOnnxSession(config: OnnxSessionConfig): Promise<OnnxSessionInfo> {
    return NativeSherpaOnnx.createOnnxSession(config);
  },

  runOnnxSession(sessionId: string, inputs: Record<string, OnnxTensorData>): Promise<OnnxInferenceResult> {
    // Convert Record<string, OnnxTensorData> to parallel arrays for the native bridge
    const entries = Object.entries(inputs);
    const inputNames = entries.map(([name]) => name);
    const inputTypes = entries.map(([, t]) => t.type);
    const inputDims = entries.map(([, t]) => t.dims.join(','));
    const inputData = entries.map(([, t]) => t.data);

    return NativeSherpaOnnx.runOnnxSession(sessionId, inputNames, inputTypes, inputDims, inputData).then(
      (result: {
        success: boolean;
        outputNames?: string[];
        outputTypes?: string[];
        outputDims?: string[];
        outputData?: string[];
        error?: string;
      }) => {
        if (!result.success || !result.outputNames) {
          return { success: result.success, error: result.error };
        }
        // Reconstruct Record<string, OnnxTensorData> from parallel arrays
        const outputs: Record<string, OnnxTensorData> = {};
        for (let i = 0; i < result.outputNames.length; i++) {
          const name = result.outputNames[i]!;
          outputs[name] = {
            type: (result.outputTypes?.[i] ?? 'float32') as OnnxTensorData['type'],
            dims: (result.outputDims?.[i] ?? '').split(',').map(Number),
            data: result.outputData?.[i] ?? '',
          };
        }
        return { success: true, outputs };
      }
    );
  },

  releaseOnnxSession(sessionId: string): Promise<{ released: boolean }> {
    return NativeSherpaOnnx.releaseOnnxSession(sessionId);
  },

  // Archive methods
  extractTarBz2({ sourcePath, targetDir }: ExtractTarBz2Input): Promise<{
    success: boolean;
    message: string;
    extractedFiles: string[];
  }> {
    return NativeSherpaOnnx.extractTarBz2(sourcePath, targetDir).then(
      (result: { success: boolean; message: string; extractedFiles?: string[] }) => ({
        ...result,
        extractedFiles: result.extractedFiles || [],
      })
    );
  },
};

// On web use WebSherpaOnnxImpl directly (already implements ApiInterface with object params).
// On native use the adapter that converts object params → positional TurboModule args.
export const SherpaOnnxAPI: ApiInterface = webImpl ?? nativeAdapter;
