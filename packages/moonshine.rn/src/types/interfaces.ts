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
  | 'error';

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
  streamId: string;
  transcriberId: string;
}

export interface MoonshineTranscriptionResult {
  lines: MoonshineTranscriptLine[];
  text: string;
}

export interface MoonshineTranscribeOptions {
  // The current React Native path streams PCM as number[] over the bridge.
  // Keep chunks reasonably small (roughly 100-250ms) until a JSI/ArrayBuffer
  // transport exists.
  chunkDurationMs?: number;
}

export interface MoonshinePlatformStatus {
  available: boolean;
  platform: 'android' | 'ios' | 'web';
  reason?: string;
}
