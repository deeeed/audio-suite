import { NativeModules, Platform } from 'react-native';
import type {
  MoonshineCreateIntentRecognizerConfig,
  MoonshineAssetModelConfig,
  MoonshineInitializeResult,
  MoonshineIntentRecognizerResult,
  MoonshineMemoryModelConfig,
  MoonshineModelConfig,
  MoonshineProcessUtteranceResult,
  MoonshineTranscriptionResult,
  MoonshineTranscribeOptions,
} from './types/interfaces';

export interface NativeMoonshineModule {
  addAudio(
    sampleRate: number,
    samples: number[]
  ): Promise<{ success: boolean }>;
  addAudioForTranscriber(
    transcriberId: string,
    sampleRate: number,
    samples: number[]
  ): Promise<{ success: boolean }>;
  addAudioToStream(
    streamId: string,
    sampleRate: number,
    samples: number[]
  ): Promise<{ success: boolean }>;
  addAudioToStreamForTranscriber(
    transcriberId: string,
    streamId: string,
    sampleRate: number,
    samples: number[]
  ): Promise<{ success: boolean }>;
  addListener(eventName: string): void;
  clearIntents(intentRecognizerId: string): Promise<{ success: boolean }>;
  createTranscriberFromAssets(
    config: MoonshineAssetModelConfig
  ): Promise<MoonshineInitializeResult>;
  createTranscriberFromFiles(
    config: MoonshineModelConfig
  ): Promise<MoonshineInitializeResult>;
  createTranscriberFromMemory(
    config: MoonshineMemoryModelConfig
  ): Promise<MoonshineInitializeResult>;
  createIntentRecognizer(
    config: MoonshineCreateIntentRecognizerConfig
  ): Promise<MoonshineIntentRecognizerResult>;
  createStream(): Promise<{ streamId: string; success: boolean }>;
  createStreamForTranscriber(
    transcriberId: string
  ): Promise<{ streamId: string; success: boolean }>;
  errorToString(code: number): Promise<string>;
  getIntentCount(intentRecognizerId: string): Promise<number>;
  getIntentThreshold(intentRecognizerId: string): Promise<number>;
  getVersion(): Promise<number>;
  initialize(config: MoonshineModelConfig): Promise<MoonshineInitializeResult>;
  loadFromAssets(
    config: MoonshineAssetModelConfig
  ): Promise<MoonshineInitializeResult>;
  loadFromFiles(
    config: MoonshineModelConfig
  ): Promise<MoonshineInitializeResult>;
  loadFromMemory(
    config: MoonshineMemoryModelConfig
  ): Promise<MoonshineInitializeResult>;
  release(): Promise<{ released: boolean }>;
  releaseTranscriber(transcriberId: string): Promise<{ released: boolean }>;
  releaseIntentRecognizer(
    intentRecognizerId: string
  ): Promise<{ success: boolean }>;
  removeListeners(count: number): void;
  removeStream(streamId: string): Promise<{ success: boolean }>;
  removeStreamForTranscriber(
    transcriberId: string,
    streamId: string
  ): Promise<{ success: boolean }>;
  processUtterance(
    intentRecognizerId: string,
    utterance: string
  ): Promise<MoonshineProcessUtteranceResult>;
  registerIntent(
    intentRecognizerId: string,
    triggerPhrase: string
  ): Promise<{ success: boolean }>;
  setIntentThreshold(
    intentRecognizerId: string,
    threshold: number
  ): Promise<{ success: boolean }>;
  start(): Promise<{ success: boolean }>;
  startTranscriber(transcriberId: string): Promise<{ success: boolean }>;
  startStream(streamId: string): Promise<{ success: boolean }>;
  startStreamForTranscriber(
    transcriberId: string,
    streamId: string
  ): Promise<{ success: boolean }>;
  stop(): Promise<{ success: boolean }>;
  stopTranscriber(transcriberId: string): Promise<{ success: boolean }>;
  stopStream(streamId: string): Promise<{ success: boolean }>;
  stopStreamForTranscriber(
    transcriberId: string,
    streamId: string
  ): Promise<{ success: boolean }>;
  transcribeFromSamples(
    sampleRate: number,
    samples: number[],
    options?: MoonshineTranscribeOptions
  ): Promise<MoonshineTranscriptionResult>;
  transcribeFromSamplesForTranscriber(
    transcriberId: string,
    sampleRate: number,
    samples: number[],
    options?: MoonshineTranscribeOptions
  ): Promise<MoonshineTranscriptionResult>;
  transcribeWithoutStreaming(
    sampleRate: number,
    samples: number[],
    options?: MoonshineTranscribeOptions
  ): Promise<MoonshineTranscriptionResult>;
  transcribeWithoutStreamingForTranscriber(
    transcriberId: string,
    sampleRate: number,
    samples: number[],
    options?: MoonshineTranscribeOptions
  ): Promise<MoonshineTranscriptionResult>;
  unregisterIntent(
    intentRecognizerId: string,
    triggerPhrase: string
  ): Promise<{ success: boolean }>;
}

// Deliberately uses legacy NativeModules for old-architecture / Expo dev-client
// compatibility. This package does not expose a TurboModule spec yet.
const NativeMoonshine = NativeModules.Moonshine as
  | NativeMoonshineModule
  | undefined;

export const MOONSHINE_EVENT_NAME = 'MoonshineTranscriptEvent';

export function isMoonshineNativeAvailable(): boolean {
  return (
    (Platform.OS === 'android' || Platform.OS === 'ios') &&
    Boolean(NativeMoonshine)
  );
}

export function getMoonshineUnavailableReason(): string | undefined {
  if (Platform.OS === 'web') {
    return 'Moonshine is not implemented on web';
  }
  if (!NativeMoonshine) {
    return 'Moonshine native module is not linked. Enable native linking for the consuming app and rebuild the app binary.';
  }
  return undefined;
}

export function requireNativeMoonshineModule(): NativeMoonshineModule {
  if (!NativeMoonshine) {
    throw new Error(
      getMoonshineUnavailableReason() ??
        'Moonshine native module is unavailable'
    );
  }
  return NativeMoonshine;
}
