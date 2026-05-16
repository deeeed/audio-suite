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
});
