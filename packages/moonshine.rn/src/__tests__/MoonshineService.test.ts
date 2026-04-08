const mockEventListeners = new Map<string, (event: unknown) => void>();

const mockNativeModule = {
  addListener: jest.fn(),
  addAudioForTranscriber: jest.fn(),
  addAudioToStreamForTranscriber: jest.fn(),
  createIntentRecognizer: jest.fn(),
  createStreamForTranscriber: jest.fn(),
  createTranscriberFromFiles: jest.fn(),
  loadFromFiles: jest.fn(),
  processUtterance: jest.fn(),
  release: jest.fn(),
  releaseIntentRecognizer: jest.fn(),
  releaseTranscriber: jest.fn(),
  removeListeners: jest.fn(),
  startTranscriber: jest.fn(),
  transcribeFromSamplesForTranscriber: jest.fn(),
  transcribeWithoutStreamingForTranscriber: jest.fn(),
};

class MockNativeEventEmitter {
  public constructor(_module?: unknown) {}

  public addListener(eventName: string, listener: (event: unknown) => void) {
    mockEventListeners.set(eventName, listener);
    return {
      remove: () => {
        mockEventListeners.delete(eventName);
      },
    };
  }
}

jest.mock('react-native', () => ({
  DeviceEventEmitter: new MockNativeEventEmitter(),
  NativeEventEmitter: MockNativeEventEmitter,
  NativeModules: {
    Moonshine: mockNativeModule,
  },
  Platform: {
    OS: 'android',
  },
}));

import { MOONSHINE_EVENT_NAME } from '../NativeMoonshine';
import { MoonshineService } from '../services/MoonshineService';

describe('MoonshineService', () => {
  beforeEach(() => {
    mockEventListeners.clear();
    for (const value of Object.values(mockNativeModule)) {
      if (typeof value === 'function' && 'mockReset' in value) {
        value.mockReset();
      }
    }
  });

  it('filters transcript events to the matching transcriber instance', async () => {
    mockNativeModule.createTranscriberFromFiles.mockResolvedValue({
      success: true,
      transcriberId: 'transcriber-1',
    });

    const service = new MoonshineService();
    const transcriber = await service.createTranscriberFromFiles({
      modelArch: 'small-streaming',
      modelPath: '/tmp/moonshine-small',
    });

    const listener = jest.fn();
    const removeListener = transcriber.addListener(listener);
    const emit = mockEventListeners.get(MOONSHINE_EVENT_NAME);

    expect(emit).toBeDefined();

    emit?.({
      streamId: 'stream-1',
      transcriberId: 'transcriber-2',
      type: 'lineCompleted',
    });
    emit?.({
      streamId: 'stream-1',
      transcriberId: 'transcriber-1',
      type: 'lineCompleted',
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      streamId: 'stream-1',
      transcriberId: 'transcriber-1',
      type: 'lineCompleted',
    });

    removeListener();
    expect(mockEventListeners.has(MOONSHINE_EVENT_NAME)).toBe(false);
  });

  it('clears the default transcriber after release()', async () => {
    mockNativeModule.loadFromFiles.mockResolvedValue({
      success: true,
      transcriberId: 'default-transcriber',
    });
    mockNativeModule.releaseTranscriber.mockResolvedValue({ released: true });

    const service = new MoonshineService();
    await service.loadFromFiles({
      modelArch: 'medium-streaming',
      modelPath: '/tmp/moonshine-medium',
    });

    await expect(service.release()).resolves.toEqual({ released: true });
    expect(mockNativeModule.releaseTranscriber).toHaveBeenCalledWith(
      'default-transcriber'
    );
    await expect(service.start()).rejects.toThrow(
      'Moonshine default transcriber is not initialized'
    );
  });

  it('wraps native intent recognizers with their bound identifier', async () => {
    mockNativeModule.createIntentRecognizer.mockResolvedValue({
      intentRecognizerId: 'intent-1',
      success: true,
    });
    mockNativeModule.processUtterance.mockResolvedValue({
      matched: true,
      match: {
        similarity: 0.97,
        triggerPhrase: 'turn on the lights',
        utterance: 'please turn on the lights',
      },
      success: true,
    });

    const service = new MoonshineService();
    const recognizer = await service.createIntentRecognizer({
      modelPath: '/tmp/embeddinggemma-300m',
    });
    const result = await recognizer.processUtterance(
      'please turn on the lights'
    );

    expect(mockNativeModule.processUtterance).toHaveBeenCalledWith(
      'intent-1',
      'please turn on the lights'
    );
    expect(result.matched).toBe(true);
    expect(result.match?.triggerPhrase).toBe('turn on the lights');
  });

  it('emits offline transcript lifecycle events from the native offline path', async () => {
    mockNativeModule.createTranscriberFromFiles.mockResolvedValue({
      success: true,
      transcriberId: 'transcriber-1',
    });
    mockNativeModule.transcribeWithoutStreamingForTranscriber.mockImplementation(
      async (_transcriberId, _sampleRate, _samples, _options) => {
        const emit = mockEventListeners.get(MOONSHINE_EVENT_NAME);
        emit?.({
          line: {
            lineId: 'line-1',
            text: 'Hello',
          },
          streamId: 'transcriber-1:default',
          transcriberId: 'transcriber-1',
          type: 'lineStarted',
        });
        emit?.({
          line: {
            lineId: 'line-1',
            hasTextChanged: true,
            isUpdated: true,
            text: 'Hello world',
          },
          streamId: 'transcriber-1:default',
          transcriberId: 'transcriber-1',
          type: 'lineTextChanged',
        });
        emit?.({
          line: {
            isFinal: true,
            lineId: 'line-1',
            text: 'Hello world',
            words: [
              { word: 'Hello', startTimeMs: 0, endTimeMs: 500 },
              { word: 'world', startTimeMs: 500, endTimeMs: 1000 },
            ],
          },
          streamId: 'transcriber-1:default',
          transcriberId: 'transcriber-1',
          type: 'lineCompleted',
        });
        return {
          text: 'Hello world',
          lines: [
            {
              lineId: 'line-1',
              text: 'Hello world',
              isFinal: true,
              words: [
                { word: 'Hello', startTimeMs: 0, endTimeMs: 500 },
                { word: 'world', startTimeMs: 500, endTimeMs: 1000 },
              ],
            },
          ],
        };
      }
    );

    const service = new MoonshineService();
    const transcriber = await service.createTranscriberFromFiles({
      modelArch: 'small-streaming',
      modelPath: '/tmp/moonshine-small',
    });

    const listener = jest.fn();
    transcriber.addListener(listener);

    const result = await transcriber.transcribeWithoutStreaming(
      16000,
      [0, 0, 0]
    );

    expect(result.text).toBe('Hello world');
    expect(
      mockNativeModule.transcribeWithoutStreamingForTranscriber
    ).toHaveBeenCalledWith('transcriber-1', 16000, [0, 0, 0], undefined);
    expect(listener).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'lineStarted',
        transcriberId: 'transcriber-1',
        streamId: 'transcriber-1:default',
      })
    );
    expect(listener).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'lineTextChanged',
        transcriberId: 'transcriber-1',
        streamId: 'transcriber-1:default',
      })
    );
    expect(listener).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: 'lineCompleted',
        transcriberId: 'transcriber-1',
        streamId: 'transcriber-1:default',
      })
    );
  });
});
