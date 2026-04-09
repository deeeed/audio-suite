export type MoonshineModelArch =
  | 'tiny'
  | 'base'
  | 'tiny-streaming'
  | 'base-streaming'
  | 'small-streaming'
  | 'medium-streaming';

export type MoonshineEmbeddingModelArch = 'gemma-300m';

export type MoonshineTranscriptEventType =
  | 'lineStarted'
  | 'lineUpdated'
  | 'lineTextChanged'
  | 'lineCompleted'
  | 'transcriptionProgress'
  | 'transcriptionCancelled'
  | 'error';

export const MOONSHINE_TRANSCRIPTION_CANCELLED_CODE =
  'MOONSHINE_TRANSCRIPTION_CANCELLED';

export interface MoonshineModelOptions {
  identifySpeakers?: boolean;
  logApiCalls?: boolean;
  logOrtRuns?: boolean;
  logOutputText?: boolean;
  maxTokensPerSecond?: number;
  saveInputWavPath?: string;
  speakerIdClusterThreshold?: number;
  vadHopSize?: number;
  vadLookBehindSampleCount?: number;
  vadMaxSegmentDurationMs?: number;
  vadThreshold?: number;
  vadWindowDurationMs?: number;
  wordTimestamps?: boolean;
}

export interface MoonshineTranscriberOption {
  name: string;
  value: boolean | number | string;
}

export interface MoonshineLoadConfigBase {
  includeAudioData?: boolean;
  language?: string;
  modelArch: MoonshineModelArch | number;
  options?: MoonshineModelOptions;
  // Web-only overrides for custom ONNX sources or a separate progress model.
  // These avoid stringly-typed transcriberOptions in normal consumers.
  webDecoderUrl?: string;
  webEncoderUrl?: string;
  webProgressModelBasePath?: string;
  transcriberOptions?: MoonshineTranscriberOption[];
  updateIntervalMs?: number;
}

export interface MoonshineModelConfig extends MoonshineLoadConfigBase {
  modelPath: string;
}

export interface MoonshineAssetModelConfig extends MoonshineLoadConfigBase {
  assetPath: string;
}

export interface MoonshineMemoryModelConfig extends MoonshineLoadConfigBase {
  // Mirrors the upstream 3-part in-memory loader. This is a low-level path and
  // currently matches the non-streaming memory layout exposed by Moonshine.
  modelData: [number[], number[], number[]];
}

export interface MoonshineInitializeResult {
  success: boolean;
  error?: string;
  transcriberId?: string;
}

export interface MoonshineCreateIntentRecognizerConfig {
  modelPath: string;
  modelArch?: MoonshineEmbeddingModelArch | number;
  modelVariant?: string;
  threshold?: number;
}

export interface MoonshineIntentMatch {
  similarity: number;
  triggerPhrase: string;
  utterance: string;
}

export interface MoonshineIntentRecognizerResult {
  intentRecognizerId: string;
  success: boolean;
}

export interface MoonshineProcessUtteranceResult {
  matched: boolean;
  match?: MoonshineIntentMatch;
  success: boolean;
}

export interface MoonshineLineWordTiming {
  confidence?: number;
  endTimeMs?: number;
  startTimeMs?: number;
  word: string;
}

export interface MoonshineTranscriptLine {
  audioData?: number[];
  lineId: string;
  text: string;
  isFinal: boolean;
  hasSpeakerId?: boolean;
  isNew?: boolean;
  isUpdated?: boolean;
  startedAtMs?: number;
  completedAtMs?: number;
  durationMs?: number;
  hasTextChanged?: boolean;
  lastTranscriptionLatencyMs?: number;
  speakerId?: string;
  speakerIndex?: number;
  words?: MoonshineLineWordTiming[];
}

export interface MoonshineTranscriptEvent {
  type: MoonshineTranscriptEventType;
  error?: string;
  line?: MoonshineTranscriptLine;
  progress?: number;
  processedDurationMs?: number;
  streamId: string;
  totalDurationMs?: number;
  transcriberId: string;
}

export interface MoonshineCancelTranscriptionResult {
  cancelled: boolean;
  success: boolean;
}

export interface MoonshineTranscriptionResult {
  lines: MoonshineTranscriptLine[];
  text: string;
}

export interface MoonshineAbortSignal {
  aborted: boolean;
  addEventListener?: (
    type: 'abort',
    listener: () => void,
    options?: { once?: boolean } | boolean
  ) => void;
  removeEventListener?: (type: 'abort', listener: () => void) => void;
  reason?: unknown;
}

export type MoonshineTranscriptionInput = number[] | Float32Array;

export interface MoonshineOfflineProgressOptions {
  intervalMs?: number;
}

export interface MoonshinePcmTranscribeOptions {
  // PCM is currently transported as number[] over the React Native bridge.
  // Keep chunks reasonably small (roughly 100-250ms) until a JSI/ArrayBuffer
  // path exists.
  chunkDurationMs?: number;
  progress?: false | MoonshineOfflineProgressOptions;
}

// moonshine.rn stays intentionally narrow: callers provide decoded mono PCM,
// while file/URI decoding and resampling live in higher-level audio utilities.
export interface MoonshineTranscribeParams
  extends MoonshinePcmTranscribeOptions {
  input: MoonshineTranscriptionInput;
  sampleRate: number;
  signal?: MoonshineAbortSignal;
}

export interface MoonshinePlatformStatus {
  available: boolean;
  platform: 'android' | 'ios' | 'web';
  reason?: string;
}
