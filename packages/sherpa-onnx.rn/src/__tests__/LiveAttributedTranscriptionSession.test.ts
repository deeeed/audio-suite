import { LiveAttributedTranscriptionSession } from '../services/LiveAttributedTranscriptionSession';
import { LiveSpeakerTurnSession } from '../services/LiveSpeakerTurnSession';
import type {
  LiveAttributedTranscriptionEvent,
  LiveSpeakerTurnSpeakerIdAdapter,
  LiveSpeakerTurnVadAdapter,
  LiveTranscriptionAsrAdapter,
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
): LiveSpeakerTurnSpeakerIdAdapter {
  let index = 0;
  return {
    async processSamples(_sampleRate: number, samples: number[]) {
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

function createAsrAdapter(
  texts: string[],
  endpoints: boolean[]
): LiveTranscriptionAsrAdapter & { resetCount: number } {
  let index = -1;
  const adapter = {
    resetCount: 0,
    async acceptWaveform() {
      index += 1;
      return { success: true };
    },
    async getResult() {
      return {
        text: texts[index] ?? texts[texts.length - 1] ?? '',
        tokens: [],
        timestamps: [],
      };
    },
    async isEndpoint() {
      return { isEndpoint: endpoints[index] ?? false };
    },
    async resetStream() {
      adapter.resetCount += 1;
      return { success: true };
    },
  };
  return adapter;
}

describe('LiveAttributedTranscriptionSession', () => {
  it('emits partial, final, and late speaker attribution update events from deterministic replay', async () => {
    const events: LiveAttributedTranscriptionEvent[] = [];
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true, false]),
      speakerId: createSpeakerIdAdapter([[1, 0]]),
      minTurnDurationMs: 10,
      speakerThreshold: 0.9,
    });
    const asr = createAsrAdapter(['hello', 'hello world'], [false, true]);
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr,
      onEvent: (event) => events.push(event),
    });

    await session.acceptChunk({ samples: createChunk(1) });
    await session.acceptChunk({ samples: createChunk(0) });

    expect(events.map((event) => event.type)).toEqual([
      'speaker_event',
      'partial_transcript',
      'speaker_event',
      'speaker_event',
      'transcript_speaker_update',
      'speaker_event',
      'speaker_event',
      'partial_transcript',
      'final_transcript',
      'turn_finalized',
    ]);

    const speakerUpdate = events.find(
      (event) => event.type === 'transcript_speaker_update'
    );
    expect(speakerUpdate).toMatchObject({
      type: 'transcript_speaker_update',
      turnId: 'turn_1',
      speakerId: 'speaker_1',
      affectedSegmentIds: ['segment_1'],
    });

    const final = events.find((event) => event.type === 'final_transcript');
    expect(final).toMatchObject({
      type: 'final_transcript',
      segmentId: 'segment_1',
      turnId: 'turn_1',
      text: 'hello world',
      speakerId: 'speaker_1',
      startMs: 0,
      endMs: 20,
    });

    const turnFinalized = events.find(
      (event) => event.type === 'turn_finalized'
    );
    expect(turnFinalized).toMatchObject({
      type: 'turn_finalized',
      turnId: 'turn_1',
      speakerId: 'speaker_1',
      segmentIds: ['segment_1'],
      text: 'hello world',
    });

    expect(asr.resetCount).toBe(1);
    expect(session.getSummary()).toEqual({
      eventCount: 10,
      segmentCount: 1,
      finalSegmentCount: 1,
      speakerAttributedSegmentCount: 1,
      durationMs: 20,
    });
  });

  it('keeps replay output deterministic and immutable through getState snapshots', async () => {
    async function runReplay(): Promise<LiveAttributedTranscriptionEvent[]> {
      const events: LiveAttributedTranscriptionEvent[] = [];
      const speakerTurns = new LiveSpeakerTurnSession({
        sampleRate: 16_000,
        vad: createVadAdapter([true, false, true, false]),
        speakerId: createSpeakerIdAdapter([
          [1, 0],
          [0, 1],
        ]),
        minTurnDurationMs: 10,
        speakerThreshold: 0.95,
      });
      const session = new LiveAttributedTranscriptionSession({
        sampleRate: 16_000,
        speakerTurns,
        asr: createAsrAdapter(
          ['hello', 'hello', 'bonjour', 'bonjour'],
          [false, true, false, true]
        ),
        onEvent: (event) => events.push(event),
      });

      for (const value of [1, 0, 2, 0]) {
        await session.acceptChunk({ samples: createChunk(value) });
      }

      const state = session.getState();
      state.segments[0]!.text = 'mutated';
      expect(session.getState().segments[0]!.text).toBe('hello');

      return events;
    }

    await expect(runReplay()).resolves.toEqual(await runReplay());
  });

  it('rejects non-monotonic sample clocks before mutating ASR state', async () => {
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([false]),
      speakerId: createSpeakerIdAdapter([[1, 0]]),
    });
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr: createAsrAdapter([''], [false]),
    });

    await session.acceptChunk({ samples: createChunk(0), startSample: 160 });
    await expect(
      session.acceptChunk({ samples: createChunk(0), startSample: 0 })
    ).rejects.toThrow('non-monotonic startSample');
  });

  it('does not advance the sample cursor when speaker turn ingestion throws', async () => {
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: {
        async acceptWaveform() {
          throw new Error('vad exploded');
        },
      },
      speakerId: createSpeakerIdAdapter([[1, 0]]),
    });
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr: createAsrAdapter([''], [false]),
    });

    await expect(
      session.acceptChunk({ samples: createChunk(1) })
    ).rejects.toThrow('vad exploded');
    expect(session.getState().nextSample).toBe(0);
  });

  it('splits transcript attribution when ASR endpointing lags behind speaker turns', async () => {
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true, false, true, false]),
      speakerId: createSpeakerIdAdapter([
        [1, 0],
        [0, 1],
      ]),
      minTurnDurationMs: 10,
      speakerThreshold: 0.95,
    });
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr: createAsrAdapter(
        ['hello', 'hello', 'hello bonjour', 'hello bonjour friend'],
        [false, false, false, true]
      ),
    });

    for (const value of [1, 0, 2, 0]) {
      await session.acceptChunk({ samples: createChunk(value) });
    }

    const segments = session.getState().segments;
    expect(segments).toEqual([
      expect.objectContaining({
        segmentId: 'segment_1',
        turnId: 'turn_1',
        speakerId: 'speaker_1',
        text: 'hello',
        final: true,
      }),
      expect.objectContaining({
        segmentId: 'segment_2',
        turnId: 'turn_2',
        speakerId: 'speaker_2',
        text: 'bonjour friend',
        final: true,
      }),
    ]);
    const turnFinalized = session
      .getState()
      .events.filter((event) => event.type === 'turn_finalized');
    expect(turnFinalized).toEqual([
      expect.objectContaining({
        turnId: 'turn_1',
        segmentIds: ['segment_1'],
        text: 'hello',
      }),
      expect.objectContaining({
        turnId: 'turn_2',
        segmentIds: ['segment_2'],
        text: 'bonjour friend',
      }),
    ]);
  });

  it('flushes pending text, reset clears replay state, and release is idempotent', async () => {
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true]),
      speakerId: createSpeakerIdAdapter([[1, 0]]),
      minTurnDurationMs: 10,
    });
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr: createAsrAdapter(['flush me'], [false]),
    });

    await session.acceptChunk({ samples: createChunk(1) });
    await session.flush();
    expect(session.getSummary()).toMatchObject({
      segmentCount: 1,
      finalSegmentCount: 1,
    });
    expect(session.getState().segments[0]).toMatchObject({
      text: 'flush me',
      final: true,
    });

    await session.reset();
    expect(session.getState()).toMatchObject({
      released: false,
      nextSample: 0,
      segments: [],
      events: [],
    });

    session.release();
    session.release();
    expect(session.getState().released).toBe(true);
    await expect(session.flush()).rejects.toThrow('has been released');
    await expect(session.acceptChunk({ samples: createChunk(0) })).rejects.toThrow(
      'has been released'
    );
  });

  it('caps retained event history while still notifying listeners', async () => {
    const observed: LiveAttributedTranscriptionEvent[] = [];
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true, true, true]),
      speakerId: createSpeakerIdAdapter([[1, 0]]),
    });
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr: createAsrAdapter(['a', 'ab', 'abc'], [false, false, false]),
      maxStoredEvents: 2,
      onEvent: (event) => observed.push(event),
    });

    await session.acceptChunk({ samples: createChunk(1) });
    await session.acceptChunk({ samples: createChunk(1) });
    await session.acceptChunk({ samples: createChunk(1) });

    expect(observed.length).toBeGreaterThan(2);
    expect(session.getSummary().eventCount).toBe(observed.length);
    expect(session.getState().events).toHaveLength(2);
  });
});
