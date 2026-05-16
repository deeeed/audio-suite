import { SherpaOnnxAPI } from './SherpaOnnxAPI';
import { ArchiveService } from './services/ArchiveService';
import { AsrService } from './services/AsrService';
import { AudioTaggingService } from './services/AudioTaggingService';
import { DiarizationService } from './services/DiarizationService';
import { DenoisingService } from './services/DenoisingService';
import { KWSService } from './services/KWSService';
import { LanguageIdService } from './services/LanguageIdService';
import { PunctuationService } from './services/PunctuationService';
import { SpeakerIdService } from './services/SpeakerIdService';
import { TtsService } from './services/TtsService';
import { OnnxInferenceService } from './services/OnnxInferenceService';
import { VadService } from './services/VadService';
import { LiveSpeakerTurnSession } from './services/LiveSpeakerTurnSession';
import { LiveAttributedTranscriptionSession } from './services/LiveAttributedTranscriptionSession';
import { SegmentedOfflineAsrSession } from './services/SegmentedOfflineAsrSession';
import type { ApiInterface } from './types/api';
import type { SherpaOnnxInterface } from './types/interfaces';

// Initialize services with API
const api: ApiInterface = SherpaOnnxAPI;
const ttsService = new TtsService(api);
const asrService = new AsrService(api);
const audioTaggingService = new AudioTaggingService(api);
const speakerIdService = new SpeakerIdService(api);
const kwsService = new KWSService(api);
const vadService = new VadService(api);
const languageIdService = new LanguageIdService(api);
const punctuationService = new PunctuationService(api);
const archiveService = new ArchiveService(api);
const diarizationService = new DiarizationService(api);
const denoisingService = new DenoisingService(api);
const onnxInferenceService = new OnnxInferenceService(api);

// Create the public interface
const SherpaOnnx: SherpaOnnxInterface = {
  ...api,
  TTS: ttsService,
  ASR: asrService,
  AudioTagging: audioTaggingService,
  SpeakerId: speakerIdService,
  KWS: kwsService,
  VAD: vadService,
  LanguageId: languageIdService,
  Punctuation: punctuationService,
  Archive: archiveService,
  Diarization: diarizationService,
  Denoising: denoisingService,
  OnnxInference: onnxInferenceService,
  LiveSpeakerTurnSession,
  LiveAttributedTranscriptionSession,
  SegmentedOfflineAsrSession,
};

// Export the main interface
export default SherpaOnnx;

// Export services for direct use
export const TTS = ttsService;
export const ASR = asrService;
export const AudioTagging = audioTaggingService;
export const SpeakerId = speakerIdService;
export const KWS = kwsService;
export const VAD = vadService;
export const LanguageId = languageIdService;
export const Punctuation = punctuationService;
export const Diarization = diarizationService;
export const Denoising = denoisingService;
export const OnnxInference = onnxInferenceService;
export { LiveSpeakerTurnSession };
export { LiveAttributedTranscriptionSession };
export { SegmentedOfflineAsrSession };

// Export types
export * from './types/api';
export * from './types/interfaces';

// Export tensor utilities
export {
  typedArrayToBase64,
  base64ToTypedArray,
  createTensorData,
  parseTensorData,
} from './utils/tensorUtils';
export type { TypedTensorData } from './utils/tensorUtils';

// Export OnnxSession class
export { OnnxSession } from './services/OnnxInferenceService';
export type {
  OnnxSessionRunFeeds,
  OnnxSessionRunOutputs,
} from './services/OnnxInferenceService';

// Export web utilities
export {
  loadWasmModule,
  configureSherpaOnnx,
  isSherpaOnnxReady,
  waitForReady,
} from './web/wasmLoader';
export type {
  SherpaOnnxConfig,
  WasmLoadOptions,
  WasmLoadProgressEvent,
} from './web/wasmLoader';
