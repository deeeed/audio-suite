import { SegmentedOfflineAsrSession } from '../services/SegmentedOfflineAsrSession';
import type {
  SegmentedOfflineAsrAdapter,
  SegmentedOfflineAsrEvent,
} from '../types/interfaces';

function createSamples(value: number, length: number): Float32Array {
  return Float32Array.from({ length }, () => value);
}

function createAsrAdapter(): SegmentedOfflineAsrAdapter & {
  calls: number[][];
} {
  const calls: number[][] = [];
  return {
    calls,
    async recognizeFromSamples(_sampleRate: number, samples: number[]) {
      calls.push(samples);
      return {
        success: true,
        text: `segment ${calls.length}`,
      };
    },
  };
}

describe('SegmentedOfflineAsrSession', () => {
  it('emits deterministic segment events while recognizing bounded windows', async () => {
    const events: SegmentedOfflineAsrEvent[] = [];
    const asr = createAsrAdapter();
    const session = new SegmentedOfflineAsrSession({
      sampleRate: 16_000,
      asr,
      segmentDurationMs: 2_000,
      onEvent: (event) => events.push(event),
    });

    await session.acceptChunk({ samples: createSamples(0.1, 16_000) });
    await session.acceptChunk({ samples: createSamples(0.2, 16_000) });
    await session.acceptChunk({
      samples: createSamples(0.3, 16_000),
      isFinal: true,
    });

    expect(asr.calls.map((samples) => samples.length)).toEqual([
      32_000,
      16_000,
    ]);
    expect(events.map((event) => event.type)).toEqual([
      'progress',
      'segment_started',
      'segment_completed',
      'progress',
      'segment_started',
      'segment_completed',
      'progress',
    ]);
    expect(session.getState().segments).toMatchObject([
      {
        segmentIndex: 1,
        startMs: 0,
        endMs: 2000,
        sampleCount: 32_000,
        final: false,
        text: 'segment 1',
      },
      {
        segmentIndex: 2,
        startMs: 2000,
        endMs: 3000,
        sampleCount: 16_000,
        final: true,
        text: 'segment 2',
      },
    ]);
    expect(session.getState().transcript).toBe('segment 1 segment 2');
    expect(session.getSummary()).toEqual({
      bufferedMs: 0,
      durationMs: 3000,
      processedMs: 3000,
      segmentCount: 2,
      transcriptCharCount: 'segment 1 segment 2'.length,
    });
  });

  it('can run cleanup between non-final segments without using native streaming APIs', async () => {
    const asr = createAsrAdapter();
    const cleanupSegments: number[] = [];
    const session = new SegmentedOfflineAsrSession({
      sampleRate: 16_000,
      asr,
      segmentDurationMs: 1_000,
      afterSegment: async (segment) => {
        cleanupSegments.push(segment.segmentIndex);
      },
    });

    await session.acceptChunk({ samples: createSamples(0.1, 16_000) });
    await session.acceptChunk({
      samples: createSamples(0.2, 8_000),
      isFinal: true,
    });

    expect(cleanupSegments).toEqual([1]);
    expect(asr.calls.map((samples) => samples.length)).toEqual([
      16_000,
      8_000,
    ]);
  });

  it('marks the exact final segment final and skips afterSegment for it', async () => {
    const events: SegmentedOfflineAsrEvent[] = [];
    const asr = createAsrAdapter();
    const cleanupSegments: number[] = [];
    const session = new SegmentedOfflineAsrSession({
      sampleRate: 16_000,
      asr,
      segmentDurationMs: 1_000,
      afterSegment: async (segment) => {
        cleanupSegments.push(segment.segmentIndex);
      },
      onEvent: (event) => events.push(event),
    });

    await session.acceptChunk({ samples: createSamples(1, 32_000), isFinal: true });

    expect(cleanupSegments).toEqual([1]);
    expect(session.getState().segments).toMatchObject([
      { segmentIndex: 1, final: false, sampleCount: 16_000 },
      { segmentIndex: 2, final: true, sampleCount: 16_000 },
    ]);
    expect(
      events
        .filter((event) => event.type === 'segment_completed')
        .map((event) => event.segment.final)
    ).toEqual([false, true]);
  });

  it('emits and throws when offline recognition fails', async () => {
    const events: SegmentedOfflineAsrEvent[] = [];
    const session = new SegmentedOfflineAsrSession({
      sampleRate: 16_000,
      segmentDurationMs: 1_000,
      asr: {
        async recognizeFromSamples() {
          return {
            success: false,
            error: 'recognizer failed',
          };
        },
      },
      onEvent: (event) => events.push(event),
    });

    await expect(
      session.acceptChunk({ samples: createSamples(1, 16_000), isFinal: true })
    ).rejects.toThrow('recognizer failed');

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          error: 'recognizer failed',
          segmentIndex: 1,
        }),
      ])
    );
  });

  it('keeps overlap context while advancing output with bounded windows', async () => {
    const asr = createAsrAdapter();
    const session = new SegmentedOfflineAsrSession({
      sampleRate: 10,
      asr,
      segmentDurationMs: 1000,
      overlapMs: 200,
    });

    await session.acceptChunk({ samples: createSamples(1, 10) });
    await session.acceptChunk({ samples: createSamples(2, 8), isFinal: true });

    expect(asr.calls.map((samples) => samples.length)).toEqual([10, 10]);
    expect(session.getState().segments.map((segment) => segment.startSample)).toEqual([
      0,
      8,
    ]);
  });

  it('rejects non-contiguous chunks before mutating the sample cursor', async () => {
    const asr = createAsrAdapter();
    const session = new SegmentedOfflineAsrSession({
      sampleRate: 16_000,
      asr,
      segmentDurationMs: 1_000,
    });

    await expect(
      session.acceptChunk({ samples: createSamples(1, 160), startSample: 160 })
    ).rejects.toThrow('non-contiguous startSample');
    expect(session.getState().nextSample).toBe(0);

    await expect(
      session.acceptChunk({ samples: createSamples(1, 160) })
    ).resolves.not.toThrow();
    expect(session.getState().nextSample).toBe(160);
  });

  it('isolates listener failures from recognition state', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const asr = createAsrAdapter();
      const observed: SegmentedOfflineAsrEvent[] = [];
      const session = new SegmentedOfflineAsrSession({
        sampleRate: 16_000,
        asr,
        segmentDurationMs: 1_000,
        onEvent: () => {
          throw new Error('listener failed');
        },
      });
      session.onEvent((event) => observed.push(event));

      await expect(
        session.acceptChunk({ samples: createSamples(1, 16_000), isFinal: true })
      ).resolves.not.toThrow();
      expect(session.getState().segments).toHaveLength(1);
      expect(observed.some((event) => event.type === 'segment_completed')).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('supports unsubscribe, bounded event history, clone integrity, and release guard', async () => {
    const asr = createAsrAdapter();
    const events: SegmentedOfflineAsrEvent[] = [];
    const session = new SegmentedOfflineAsrSession({
      sampleRate: 16_000,
      asr,
      segmentDurationMs: 1_000,
      maxStoredEvents: 2,
    });
    const unsubscribe = session.onEvent((event) => events.push(event));

    await session.acceptChunk({ samples: createSamples(1, 16_000) });
    unsubscribe();
    await session.acceptChunk({ samples: createSamples(2, 16_000), isFinal: true });

    expect(events.length).toBeGreaterThan(0);
    expect(session.getState().events).toHaveLength(2);

    const state = session.getState();
    state.segments[0]!.text = 'mutated';
    expect(session.getState().segments[0]!.text).toBe('segment 1');

    session.release();
    await expect(
      session.acceptChunk({ samples: createSamples(3, 1) })
    ).rejects.toThrow('has been released');
  });
});
