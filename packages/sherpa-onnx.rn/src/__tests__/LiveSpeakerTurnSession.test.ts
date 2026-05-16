import { LiveSpeakerTurnSession } from '../services/LiveSpeakerTurnSession';
import type {
  LiveSpeakerTurnEvent,
  LiveSpeakerTurnSpeakerIdAdapter,
  LiveSpeakerTurnVadAdapter,
  VadAcceptWaveformResult,
} from '../types/interfaces';

function createChunk(value: number, length = 160): number[] {
  return Array.from({ length }, () => value);
}

function createVadAdapter(decisions: boolean[]): LiveSpeakerTurnVadAdapter {
  let index = 0;
  return {
    async acceptWaveform(): Promise<VadAcceptWaveformResult> {
      const isSpeechDetected = decisions[index] ?? false;
      index += 1;
      return {
        success: true,
        isSpeechDetected,
        segments: [],
      };
    },
  };
}

function createSpeakerIdAdapter(
  embeddings: number[][]
): LiveSpeakerTurnSpeakerIdAdapter & { processedSamples: number[] } {
  let index = 0;
  const processedSamples: number[] = [];
  return {
    processedSamples,
    async processSamples(_sampleRate: number, samples: number[]) {
      processedSamples.push(samples.length);
      return {
        success: true,
        samplesProcessed: samples.length,
      };
    },
    async computeEmbedding() {
      const embedding = embeddings[index] ?? embeddings[embeddings.length - 1];
      index += 1;
      return {
        success: true,
        durationMs: 1,
        embedding: embedding ?? [1, 0],
        embeddingDim: embedding?.length ?? 2,
      };
    },
  };
}

describe('LiveSpeakerTurnSession', () => {
  it('emits a deterministic speaker turn event sequence from mocked VAD and Speaker ID adapters', async () => {
    const events: LiveSpeakerTurnEvent[] = [];
    const speakerId = createSpeakerIdAdapter([[1, 0]]);
    const session = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([false, true, true, false]),
      speakerId,
      minTurnDurationMs: 10,
      speakerThreshold: 0.9,
      onEvent: (event) => events.push(event),
    });

    await session.acceptChunk({ samples: createChunk(0) });
    await session.acceptChunk({ samples: createChunk(1) });
    await session.acceptChunk({ samples: createChunk(1) });
    await session.acceptChunk({ samples: createChunk(0) });

    expect(events.map((event) => event.type)).toEqual([
      'speech_start',
      'speech_end',
      'speaker_pending',
      'speaker_resolved',
      'turn_final',
    ]);
    expect(events[0]).toMatchObject({
      type: 'speech_start',
      turnId: 'turn_1',
      startMs: 10,
      startSample: 160,
    });
    expect(events[4]).toMatchObject({
      type: 'turn_final',
      turnId: 'turn_1',
      speakerId: 'speaker_1',
      startMs: 10,
      endMs: 40,
    });
    expect(speakerId.processedSamples).toEqual([480]);
    expect(session.getSummary()).toEqual({
      eventCount: 5,
      turnCount: 1,
      speakerCount: 1,
      durationMs: 40,
    });
  });

  it('keeps same-speaker repeated turns mapped to a stable speaker id', async () => {
    const events: LiveSpeakerTurnEvent[] = [];
    const session = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true, false, false, true, false]),
      speakerId: createSpeakerIdAdapter([
        [1, 0],
        [0.99, 0.01],
      ]),
      minTurnDurationMs: 10,
      speakerThreshold: 0.95,
      onEvent: (event) => events.push(event),
    });

    for (const value of [1, 0, 0, 1, 0]) {
      await session.acceptChunk({ samples: createChunk(value) });
    }

    const finals = events.filter((event) => event.type === 'turn_final');
    expect(finals).toHaveLength(2);
    expect(finals.map((event) => event.speakerId)).toEqual([
      'speaker_1',
      'speaker_1',
    ]);
    expect(session.getState().speakers).toMatchObject([
      { speakerId: 'speaker_1', turnCount: 2 },
    ]);
  });

  it('does not expose mutable speaker centroid embeddings through getState', async () => {
    const events: LiveSpeakerTurnEvent[] = [];
    const session = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true, false, false, true, false]),
      speakerId: createSpeakerIdAdapter([
        [1, 0],
        [0.99, 0.01],
      ]),
      minTurnDurationMs: 10,
      speakerThreshold: 0.95,
      onEvent: (event) => events.push(event),
    });

    await session.acceptChunk({ samples: createChunk(1) });
    await session.acceptChunk({ samples: createChunk(0) });

    const state = session.getState();
    state.speakers[0]!.embedding[0] = 0;
    state.speakers[0]!.embedding[1] = 1;

    await session.acceptChunk({ samples: createChunk(0) });
    await session.acceptChunk({ samples: createChunk(1) });
    await session.acceptChunk({ samples: createChunk(0) });

    const finals = events.filter((event) => event.type === 'turn_final');
    expect(finals.map((event) => event.speakerId)).toEqual([
      'speaker_1',
      'speaker_1',
    ]);
  });

  it('produces repeatable event streams for fixed replay input', async () => {
    async function runReplay(): Promise<LiveSpeakerTurnEvent[]> {
      const events: LiveSpeakerTurnEvent[] = [];
      const session = new LiveSpeakerTurnSession({
        sampleRate: 16_000,
        vad: createVadAdapter([true, false, true, false]),
        speakerId: createSpeakerIdAdapter([
          [1, 0],
          [0, 1],
        ]),
        minTurnDurationMs: 10,
        speakerThreshold: 0.95,
        onEvent: (event) => events.push(event),
      });

      for (const value of [1, 0, 2, 0]) {
        await session.acceptChunk({ samples: createChunk(value) });
      }
      return events;
    }

    await expect(runReplay()).resolves.toEqual(await runReplay());
  });

  it('caps retained event history while keeping total event count', async () => {
    const observed: LiveSpeakerTurnEvent[] = [];
    const session = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true, false, true, false]),
      speakerId: createSpeakerIdAdapter([[1, 0]]),
      minTurnDurationMs: 10,
      maxStoredEvents: 2,
      onEvent: (event) => observed.push(event),
    });

    for (const value of [1, 0, 1, 0]) {
      await session.acceptChunk({ samples: createChunk(value) });
    }

    expect(observed.length).toBeGreaterThan(2);
    expect(session.getState().events).toHaveLength(2);
    expect(session.getSummary().eventCount).toBe(observed.length);
    expect(session.getSummary().turnCount).toBe(2);
  });

  it('rolls back sample cursor when VAD throws so callers can retry', async () => {
    let attempts = 0;
    const session = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: {
        async acceptWaveform() {
          attempts += 1;
          if (attempts === 1) {
            throw new Error('vad exploded');
          }
          return { success: true, isSpeechDetected: false, segments: [] };
        },
      },
      speakerId: createSpeakerIdAdapter([[1, 0]]),
    });

    await expect(session.acceptChunk({ samples: createChunk(1) })).rejects.toThrow(
      'vad exploded'
    );
    expect(session.getState().nextSample).toBe(0);
    await expect(session.acceptChunk({ samples: createChunk(1) })).resolves.not.toThrow();
    expect(session.getState().nextSample).toBe(160);
  });

  it('does not append later turns to a failed speaker embedding stream', async () => {
    const events: LiveSpeakerTurnEvent[] = [];
    let processCalls = 0;
    const session = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true, false, true, false]),
      speakerId: {
        async processSamples() {
          processCalls += 1;
          return { success: true, samplesProcessed: 160 };
        },
        async computeEmbedding() {
          return {
            success: false,
            durationMs: 0,
            embedding: [],
            embeddingDim: 0,
            error: 'not enough audio',
          };
        },
      },
      minTurnDurationMs: 10,
      onEvent: (event) => events.push(event),
    });

    for (const value of [1, 0, 2, 0]) {
      await session.acceptChunk({ samples: createChunk(value) });
    }

    expect(processCalls).toBe(1);
    expect(events.filter((event) => event.type === 'turn_final')).toHaveLength(2);
    expect(events).toContainEqual({
      type: 'error',
      turnId: 'turn_2',
      error: 'Speaker ID stream requires session reset after a failed embedding attempt',
    });
  });

  it('marks capped sub-threshold speaker assignments as forced fallback', async () => {
    const events: LiveSpeakerTurnEvent[] = [];
    const session = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true, false, true, false]),
      speakerId: createSpeakerIdAdapter([
        [1, 0],
        [0, 1],
      ]),
      minTurnDurationMs: 10,
      maxSpeakers: 1,
      speakerThreshold: 0.95,
      onEvent: (event) => events.push(event),
    });

    for (const value of [1, 0, 2, 0]) {
      await session.acceptChunk({ samples: createChunk(value) });
    }

    const resolved = events.filter((event) => event.type === 'speaker_resolved');
    expect(resolved).toHaveLength(2);
    expect(resolved[1]).toMatchObject({
      speakerId: 'speaker_1',
      provenance: 'forced_fallback',
    });
  });

  it('restores an evicted ring buffer when VAD throws', async () => {
    const processedSamples: number[][] = [];
    let calls = 0;
    const session = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: {
        async acceptWaveform() {
          calls += 1;
          if (calls === 3) {
            throw new Error('vad exploded after eviction');
          }
          return {
            success: true,
            isSpeechDetected: calls < 4,
            segments: [],
          };
        },
      },
      speakerId: {
        async processSamples(_sampleRate, samples) {
          processedSamples.push(samples);
          return { success: true, samplesProcessed: samples.length };
        },
        async computeEmbedding() {
          return {
            success: true,
            durationMs: 1,
            embedding: [1, 0],
            embeddingDim: 2,
          };
        },
      },
      minTurnDurationMs: 10,
      maxRingBufferDurationMs: 19,
    });

    await session.acceptChunk({ samples: createChunk(1) });
    await session.acceptChunk({ samples: createChunk(2) });
    await expect(session.acceptChunk({ samples: createChunk(3) })).rejects.toThrow(
      'vad exploded after eviction'
    );
    await session.acceptChunk({ samples: createChunk(3) });

    expect(processedSamples).toHaveLength(1);
    expect(processedSamples[0]?.[0]).toBe(2);
    expect(processedSamples[0]?.[processedSamples[0].length - 1]).toBe(3);
  });

  it('rejects non-contiguous sample clocks', async () => {
    const session = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([false]),
      speakerId: createSpeakerIdAdapter([[1, 0]]),
    });

    await expect(
      session.acceptChunk({ samples: createChunk(0), startSample: 160 })
    ).rejects.toThrow('non-contiguous startSample');
    await session.acceptChunk({ samples: createChunk(0) });
    await expect(
      session.acceptChunk({ samples: createChunk(0), startSample: 0 })
    ).rejects.toThrow('non-contiguous startSample');
  });
});
