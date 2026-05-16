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
    const stateTurnFinalized = session
      .getState()
      .events.find((event) => event.type === 'turn_finalized');
    if (stateTurnFinalized?.type === 'turn_finalized') {
      stateTurnFinalized.segmentIds.push('mutated');
    }
    expect(
      session
        .getState()
        .events.find((event) => event.type === 'turn_finalized')
    ).toMatchObject({
      segmentIds: ['segment_1'],
    });

    expect(asr.resetCount).toBe(1);
    expect(session.getSummary()).toEqual({
      eventCount: 9,
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

  it('rejects non-contiguous sample clocks before mutating ASR state', async () => {
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

    await session.acceptChunk({ samples: createChunk(0) });
    await expect(
      session.acceptChunk({ samples: createChunk(0), startSample: 0 })
    ).rejects.toThrow('non-contiguous startSample');
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
    expect(speakerTurns.getState().nextSample).toBe(0);
  });

  it('can retry a chunk after speaker turn ingestion throws', async () => {
    let attempts = 0;
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: {
        async acceptWaveform() {
          attempts += 1;
          if (attempts === 1) {
            throw new Error('vad exploded');
          }
          return { success: true, isSpeechDetected: true, segments: [] };
        },
      },
      speakerId: createSpeakerIdAdapter([[1, 0]]),
    });
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr: createAsrAdapter(['retry ok'], [false]),
    });

    await expect(session.acceptChunk({ samples: createChunk(1) })).rejects.toThrow(
      'vad exploded'
    );
    await expect(session.acceptChunk({ samples: createChunk(1) })).resolves.not.toThrow();

    expect(session.getState()).toMatchObject({
      nextSample: 160,
      segments: [expect.objectContaining({ text: 'retry ok' })],
    });
  });

  it('emits one normalized speaker-turn error without feeding ASR on VAD failure', async () => {
    const events: LiveAttributedTranscriptionEvent[] = [];
    let asrAcceptCount = 0;
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: {
        async acceptWaveform() {
          return {
            success: false,
            error: 'vad failed',
            isSpeechDetected: false,
            segments: [],
          };
        },
      },
      speakerId: createSpeakerIdAdapter([[1, 0]]),
    });
    const asr = {
      async acceptWaveform() {
        asrAcceptCount += 1;
        return { success: true };
      },
      async getResult() {
        return { text: '' };
      },
      async isEndpoint() {
        return { isEndpoint: false };
      },
      async resetStream() {
        return { success: true };
      },
    } satisfies LiveTranscriptionAsrAdapter;
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr,
      onEvent: (event) => events.push(event),
    });

    await expect(session.acceptChunk({ samples: createChunk(1) })).rejects.toThrow(
      'vad failed'
    );

    expect(asrAcceptCount).toBe(0);
    expect(session.getState().nextSample).toBe(0);
    expect(speakerTurns.getState().nextSample).toBe(0);
    expect(events).toEqual([
      {
        type: 'error',
        source: 'speaker_turn',
        error: 'vad failed',
      },
    ]);
  });

  it('converts ASR accept rejections into error events after consumed audio advances', async () => {
    const events: LiveAttributedTranscriptionEvent[] = [];
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([false]),
      speakerId: createSpeakerIdAdapter([[1, 0]]),
    });
    const asr = {
      async acceptWaveform() {
        throw new Error('accept failed');
      },
      async getResult() {
        return { text: '' };
      },
      async isEndpoint() {
        return { isEndpoint: false };
      },
      async resetStream() {
        return { success: true };
      },
    } satisfies LiveTranscriptionAsrAdapter;
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr,
      onEvent: (event) => events.push(event),
    });

    await session.acceptChunk({ samples: createChunk(0) });

    expect(session.getState().nextSample).toBe(160);
    expect(events).toContainEqual({
      type: 'error',
      source: 'asr',
      error: 'accept failed',
    });
  });

  it('converts ASR result exceptions into error events after consumed audio advances', async () => {
    const events: LiveAttributedTranscriptionEvent[] = [];
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([false]),
      speakerId: createSpeakerIdAdapter([[1, 0]]),
    });
    const asr = {
      async acceptWaveform() {
        return { success: true };
      },
      async getResult() {
        throw new Error('result failed');
      },
      async isEndpoint() {
        return { isEndpoint: false };
      },
      async resetStream() {
        return { success: true };
      },
    } satisfies LiveTranscriptionAsrAdapter;
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr,
      onEvent: (event) => events.push(event),
    });

    await session.acceptChunk({ samples: createChunk(1) });

    expect(session.getState().nextSample).toBe(160);
    expect(events).toContainEqual({
      type: 'error',
      source: 'asr',
      error: 'result failed',
    });
  });

  it('creates an unattributed final segment when ASR text first appears during flush', async () => {
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([false]),
      speakerId: createSpeakerIdAdapter([[1, 0]]),
    });
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr: createAsrAdapter(['', 'tail final'], [false, false]),
    });

    await session.acceptChunk({ samples: createChunk(0) });
    expect(session.getState().segments).toEqual([]);

    await session.flush();

    expect(session.getState().segments).toEqual([
      expect.objectContaining({
        text: 'tail final',
        final: true,
        turnId: undefined,
      }),
    ]);
  });

  it('converts ASR tail-padding accept rejections into error events during flush', async () => {
    const events: LiveAttributedTranscriptionEvent[] = [];
    let acceptCount = 0;
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true]),
      speakerId: createSpeakerIdAdapter([[1, 0]]),
      minTurnDurationMs: 1,
    });
    const asr = {
      async acceptWaveform() {
        acceptCount += 1;
        if (acceptCount === 2) {
          throw new Error('tail accept rejected');
        }
        return { success: true };
      },
      async getResult() {
        return { text: 'hello' };
      },
      async isEndpoint() {
        return { isEndpoint: false };
      },
      async resetStream() {
        return { success: true };
      },
    } satisfies LiveTranscriptionAsrAdapter;
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr,
      onEvent: (event) => events.push(event),
    });

    await session.acceptChunk({ samples: createChunk(1) });
    await session.flush();

    expect(events).toContainEqual({
      type: 'error',
      source: 'asr',
      error: 'tail accept rejected',
    });
    expect(session.getState().segments[0]).toMatchObject({
      text: 'hello',
      final: true,
    });
  });

  it('converts ASR reset rejections during flush into error events', async () => {
    const events: LiveAttributedTranscriptionEvent[] = [];
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true]),
      speakerId: createSpeakerIdAdapter([[1, 0]]),
      minTurnDurationMs: 1,
    });
    const asr = {
      async acceptWaveform() {
        return { success: true };
      },
      async getResult() {
        return { text: 'hello' };
      },
      async isEndpoint() {
        return { isEndpoint: false };
      },
      async resetStream() {
        throw new Error('flush reset rejected');
      },
    } satisfies LiveTranscriptionAsrAdapter;
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr,
      onEvent: (event) => events.push(event),
    });

    await session.acceptChunk({ samples: createChunk(1) });
    await session.flush();

    expect(events).toContainEqual({
      type: 'error',
      source: 'asr',
      error: 'flush reset rejected',
    });
    expect(session.getState().segments[0]).toMatchObject({ final: true });
  });

  it('converts ASR reset rejections during reset into retained error events', async () => {
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([false]),
      speakerId: createSpeakerIdAdapter([[1, 0]]),
    });
    const asr = {
      async acceptWaveform() {
        return { success: true };
      },
      async getResult() {
        return { text: '' };
      },
      async isEndpoint() {
        return { isEndpoint: false };
      },
      async resetStream() {
        throw new Error('reset rejected');
      },
    } satisfies LiveTranscriptionAsrAdapter;
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr,
    });

    await session.acceptChunk({ samples: createChunk(0) });
    await session.reset();

    expect(session.getState()).toMatchObject({
      nextSample: 0,
      segments: [],
      events: [
        {
          type: 'error',
          source: 'asr',
          error: 'reset rejected',
        },
      ],
    });
  });

  it('feeds tail padding on flush so ASR can expose final right-context text', async () => {
    const asr = createAsrAdapter(['hel', 'hello'], [false, false]);
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true]),
      speakerId: createSpeakerIdAdapter([[1, 0]]),
      minTurnDurationMs: 10,
    });
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr,
      flushTailPaddingMs: 10,
    });

    await session.acceptChunk({ samples: createChunk(1) });
    await session.flush();

    expect(session.getState().segments[0]).toMatchObject({
      text: 'hello',
      final: true,
    });
    expect(asr.resetCount).toBe(1);
  });

  it('resets ASR stream on flush before accepting a new utterance', async () => {
    let phase: 'first' | 'second' = 'first';
    const asr = {
      async acceptWaveform() {
        return { success: true };
      },
      async getResult() {
        return { text: phase === 'first' ? 'hello' : 'next' };
      },
      async isEndpoint() {
        return { isEndpoint: false };
      },
      async resetStream() {
        phase = 'second';
        return { success: true };
      },
    } satisfies LiveTranscriptionAsrAdapter;
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true, false, true]),
      speakerId: createSpeakerIdAdapter([
        [1, 0],
        [0, 1],
      ]),
      minTurnDurationMs: 10,
    });
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr,
      flushTailPaddingMs: 10,
    });

    await session.acceptChunk({ samples: createChunk(1) });
    await session.flush();
    await session.acceptChunk({ samples: createChunk(1) });

    expect(session.getState().segments.map((segment) => segment.text)).toEqual([
      'hello',
      'next',
    ]);
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
        ['hello', 'hello', 'bonjour', 'bonjour friend'],
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
    const eventTypes = session.getState().events.map((event) => event.type);
    expect(eventTypes.indexOf('final_transcript')).toBeLessThan(
      eventTypes.indexOf('turn_finalized')
    );
  });

  it('resets ASR at speaker boundaries so delayed prior text is not assigned to the next speaker', async () => {
    let resetCount = 0;
    let acceptCount = 0;
    const asr = {
      async acceptWaveform() {
        acceptCount += 1;
        return { success: true };
      },
      async getResult() {
        if (acceptCount < 3) {
          return { text: '' };
        }
        return {
          text: resetCount > 0 ? 'second speaker' : 'delayed first speaker',
        };
      },
      async isEndpoint() {
        return { isEndpoint: false };
      },
      async resetStream() {
        resetCount += 1;
        return { success: true };
      },
    } satisfies LiveTranscriptionAsrAdapter;
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true, false, true]),
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
      asr,
    });

    for (const value of [1, 0, 2]) {
      await session.acceptChunk({ samples: createChunk(value) });
    }

    expect(resetCount).toBeGreaterThan(0);
    expect(session.getState().segments).toEqual([
      expect.objectContaining({
        turnId: 'turn_2',
        text: 'second speaker',
      }),
    ]);
  });

  it('converts boundary ASR reset rejections into error events', async () => {
    const events: LiveAttributedTranscriptionEvent[] = [];
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true, false, true]),
      speakerId: createSpeakerIdAdapter([
        [1, 0],
        [0, 1],
      ]),
      minTurnDurationMs: 10,
    });
    const asr = {
      async acceptWaveform() {
        return { success: true };
      },
      async getResult() {
        return { text: 'hello' };
      },
      async isEndpoint() {
        return { isEndpoint: false };
      },
      async resetStream() {
        throw new Error('reset rejected');
      },
    } satisfies LiveTranscriptionAsrAdapter;
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr,
      onEvent: (event) => events.push(event),
    });

    for (const value of [1, 0, 2]) {
      await session.acceptChunk({ samples: createChunk(value) });
    }

    expect(session.getState().nextSample).toBe(480);
    expect(events).toContainEqual({
      type: 'error',
      source: 'asr',
      error: 'reset rejected',
    });
  });

  it('keeps sample clock monotonic when boundary ASR reset fails', async () => {
    let resetCount = 0;
    const asr = {
      async acceptWaveform() {
        return { success: true };
      },
      async getResult() {
        return { text: 'hello' };
      },
      async isEndpoint() {
        return { isEndpoint: false };
      },
      async resetStream() {
        resetCount += 1;
        return resetCount === 1
          ? { success: false, error: 'reset failed' }
          : { success: true };
      },
    } satisfies LiveTranscriptionAsrAdapter;
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true, false, true]),
      speakerId: createSpeakerIdAdapter([
        [1, 0],
        [0, 1],
      ]),
      minTurnDurationMs: 10,
    });
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr,
    });

    for (const value of [1, 0, 2]) {
      await session.acceptChunk({ samples: createChunk(value) });
    }

    expect(session.getState().nextSample).toBe(480);
    await expect(session.acceptChunk({ samples: createChunk(2) })).resolves.not.toThrow();
  });

  it('removes registered event listeners with unsubscribe', async () => {
    const observed: LiveAttributedTranscriptionEvent[] = [];
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true, true]),
      speakerId: createSpeakerIdAdapter([[1, 0]]),
    });
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr: createAsrAdapter(['first', 'second'], [false, false]),
    });

    const unsubscribe = session.onEvent((event) => observed.push(event));
    await session.acceptChunk({ samples: createChunk(1) });
    expect(observed.length).toBeGreaterThan(0);

    unsubscribe();
    const observedCount = observed.length;
    await session.acceptChunk({ samples: createChunk(1) });

    expect(observed).toHaveLength(observedCount);
    expect(session.getSummary().eventCount).toBeGreaterThan(observedCount);
  });

  it('clears stale active attribution and ASR context for discarded short turns', async () => {
    const events: LiveAttributedTranscriptionEvent[] = [];
    let acceptedChunks = 0;
    let resetCount = 0;
    const asr = {
      async acceptWaveform() {
        acceptedChunks += 1;
        return { success: true };
      },
      async getResult() {
        if (resetCount === 0) {
          return { text: 'discarded noise' };
        }
        return { text: acceptedChunks >= 3 ? 'real speech' : '' };
      },
      async isEndpoint() {
        return { isEndpoint: false };
      },
      async resetStream() {
        resetCount += 1;
        return { success: true };
      },
    } satisfies LiveTranscriptionAsrAdapter;
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true, false, true]),
      speakerId: createSpeakerIdAdapter([[1, 0]]),
      minTurnDurationMs: 1_000,
    });
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr,
      onEvent: (event) => events.push(event),
    });

    for (const value of [1, 0, 2]) {
      await session.acceptChunk({ samples: createChunk(value) });
    }

    expect(resetCount).toBe(1);
    expect(
      events.some(
        (event) =>
          event.type === 'speaker_event' &&
          event.event.type === 'turn_discarded'
      )
    ).toBe(false);
    expect(session.getState().segments).toEqual([
      expect.objectContaining({
        turnId: 'turn_2',
        text: 'real speech',
      }),
    ]);
  });

  it('removes finalized transcript segments for turns later discarded as too short', async () => {
    const events: LiveAttributedTranscriptionEvent[] = [];
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true, false]),
      speakerId: createSpeakerIdAdapter([[1, 0]]),
      minTurnDurationMs: 1_000,
    });
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr: createAsrAdapter(['short noise', ''], [true, false]),
      onEvent: (event) => events.push(event),
    });

    await session.acceptChunk({ samples: createChunk(1) });
    expect(session.getState().segments).toEqual([
      expect.objectContaining({ turnId: 'turn_1', final: true }),
    ]);

    await session.acceptChunk({ samples: createChunk(0) });

    expect(events).toContainEqual({
      type: 'transcript_segment_removed',
      segmentId: 'segment_1',
      turnId: 'turn_1',
      reason: 'turn_discarded',
      text: 'short noise',
      final: true,
    });
    expect(session.getState().segments).toEqual([]);
    expect(session.getSummary()).toMatchObject({
      segmentCount: 0,
      finalSegmentCount: 0,
    });
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

  it('drops empty abandoned segments instead of surfacing ghosts', async () => {
    const speakerTurns = new LiveSpeakerTurnSession({
      sampleRate: 16_000,
      vad: createVadAdapter([true]),
      speakerId: createSpeakerIdAdapter([[1, 0]]),
    });
    const session = new LiveAttributedTranscriptionSession({
      sampleRate: 16_000,
      speakerTurns,
      asr: createAsrAdapter([''], [false]),
    });

    await session.acceptChunk({ samples: createChunk(1) });
    await session.flush();

    expect(session.getSummary()).toMatchObject({
      segmentCount: 0,
      finalSegmentCount: 0,
    });
    expect(session.getState().segments).toEqual([]);
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

    const snapshot = session.getState();
    const speakerEvent = snapshot.events.find(
      (event) => event.type === 'speaker_event'
    );
    if (speakerEvent?.type === 'speaker_event') {
      speakerEvent.event.type = 'error';
    }
    expect(observed.length).toBeGreaterThan(2);
    expect(session.getSummary().eventCount).toBe(observed.length);
    expect(session.getState().events).toHaveLength(2);
    expect(session.getState().events[0]).not.toMatchObject({
      event: { type: 'error' },
    });
  });
});
