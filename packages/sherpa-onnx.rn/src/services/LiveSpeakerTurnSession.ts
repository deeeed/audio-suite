import type {
  LiveSpeakerTurnChunk,
  LiveSpeakerTurnConfig,
  LiveSpeakerTurnEvent,
  LiveSpeakerTurnEventListener,
  LiveSpeakerTurnSessionState,
  LiveSpeakerTurnProvenance,
  LiveSpeakerTurnSpeakerCentroid,
  LiveSpeakerTurnSummary,
  SpeakerEmbeddingResult,
  SpeakerIdProcessResult,
  VadAcceptWaveformResult,
} from '../types/interfaces';

interface BufferedChunk {
  startSample: number;
  samples: number[];
}

const DEFAULT_MIN_TURN_DURATION_MS = 250;
const DEFAULT_SPEAKER_THRESHOLD = 0.5;
const DEFAULT_MAX_RING_BUFFER_DURATION_MS = 60_000;
const DEFAULT_CENTROID_UPDATE_ALPHA = 0.25;
const DEFAULT_MAX_STORED_EVENTS = 1000;

function samplesToMs(samples: number, sampleRate: number): number {
  return (samples / sampleRate) * 1000;
}

function msToSamples(ms: number, sampleRate: number): number {
  return Math.round((ms / 1000) * sampleRate);
}

function normalizeEmbedding(embedding: number[]): number[] {
  const magnitude = Math.sqrt(
    embedding.reduce((sum, value) => sum + value * value, 0)
  );
  if (magnitude === 0) {
    return embedding.map(() => 0);
  }
  return embedding.map((value) => value / magnitude);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) {
    score += (a[index] ?? 0) * (b[index] ?? 0);
  }
  return score;
}

function cloneEvent(event: LiveSpeakerTurnEvent): LiveSpeakerTurnEvent {
  return { ...event };
}

function movingAverageCentroid(
  current: number[],
  next: number[],
  alpha: number
): number[] {
  const length = Math.max(current.length, next.length);
  const merged: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const currentValue = current[index] ?? 0;
    const nextValue = next[index] ?? 0;
    merged.push(currentValue * (1 - alpha) + nextValue * alpha);
  }
  return normalizeEmbedding(merged);
}

/**
 * Replayable live speaker-turn session built from VAD + Speaker ID adapters.
 *
 * This class intentionally stays in TypeScript and has no native dependency. It
 * owns the event contract and deterministic sample-clock behavior so later PRs
 * can wire real mobile audio sources without changing public events.
 */
export class LiveSpeakerTurnSession {
  private readonly config: LiveSpeakerTurnConfig;
  private readonly listeners = new Set<LiveSpeakerTurnEventListener>();
  private readonly emittedEvents: LiveSpeakerTurnEvent[] = [];
  private readonly ringBuffer: BufferedChunk[] = [];
  private eventCount = 0;
  private finalizedTurnCount = 0;
  private readonly finalizedSpeakerIds = new Set<string>();
  private readonly centroids: LiveSpeakerTurnSpeakerCentroid[] = [];
  private nextSample = 0;
  private nextTurnIndex = 1;
  private nextSpeakerIndex = 1;
  private activeTurnId: string | null = null;
  private activeTurnStartSample: number | null = null;
  private speechActive = false;
  private speakerIdUsable = true;
  private released = false;

  constructor(config: LiveSpeakerTurnConfig) {
    if (!Number.isFinite(config.sampleRate) || config.sampleRate <= 0) {
      throw new Error('LiveSpeakerTurnSession requires a positive sampleRate');
    }
    this.config = config;
    if (config.onEvent) {
      this.listeners.add(config.onEvent);
    }
  }

  public onEvent(listener: LiveSpeakerTurnEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): LiveSpeakerTurnSessionState {
    return {
      released: this.released,
      speechActive: this.speechActive,
      activeTurnId: this.activeTurnId,
      nextSample: this.nextSample,
      speakers: this.centroids.map((centroid) => ({
        ...centroid,
        embedding: [...centroid.embedding],
      })),
      events: this.emittedEvents.map(cloneEvent),
    };
  }

  public async acceptChunk(chunk: LiveSpeakerTurnChunk): Promise<void> {
    this.ensureNotReleased();

    const sampleRate = chunk.sampleRate ?? this.config.sampleRate;
    if (sampleRate !== this.config.sampleRate) {
      throw new Error(
        `LiveSpeakerTurnSession expected sampleRate ${this.config.sampleRate}, received ${sampleRate}`
      );
    }

    const startSample = chunk.startSample ?? this.nextSample;
    if (startSample !== this.nextSample) {
      throw new Error(
        `LiveSpeakerTurnSession received non-contiguous startSample ${startSample}; next expected sample is ${this.nextSample}`
      );
    }

    const samples = Array.from(chunk.samples);
    const previousNextSample = this.nextSample;
    // Shallow copy is sufficient because BufferedChunk entries and sample arrays
    // are append-only after insertion; rollback only restores membership/order.
    const previousRingBuffer = this.ringBuffer.slice();
    this.appendToRingBuffer(startSample, samples);
    this.nextSample = startSample + samples.length;

    let vadResult: VadAcceptWaveformResult;
    try {
      vadResult = await this.config.vad.acceptWaveform(sampleRate, samples);
    } catch (error) {
      this.ringBuffer.splice(0, this.ringBuffer.length, ...previousRingBuffer);
      this.nextSample = previousNextSample;
      throw error;
    }
    if (!vadResult.success) {
      const error = vadResult.error ?? 'VAD failed while processing live chunk';
      this.ringBuffer.splice(0, this.ringBuffer.length, ...previousRingBuffer);
      this.nextSample = previousNextSample;
      this.emit({
        type: 'error',
        error,
      });
      throw new Error(error);
    }

    if (vadResult.isSpeechDetected && !this.speechActive) {
      this.startTurn(startSample);
    }

    if (!vadResult.isSpeechDetected && this.speechActive) {
      await this.finishTurn(this.nextSample);
    }
  }

  public async flush(): Promise<void> {
    this.ensureNotReleased();
    if (this.speechActive) {
      await this.finishTurn(this.nextSample);
    }
  }

  public reset(): void {
    this.ensureNotReleased();
    this.ringBuffer.splice(0, this.ringBuffer.length);
    this.centroids.splice(0, this.centroids.length);
    this.emittedEvents.splice(0, this.emittedEvents.length);
    this.eventCount = 0;
    this.finalizedTurnCount = 0;
    this.finalizedSpeakerIds.clear();
    this.nextSample = 0;
    this.nextTurnIndex = 1;
    this.nextSpeakerIndex = 1;
    this.activeTurnId = null;
    this.activeTurnStartSample = null;
    this.speechActive = false;
    this.speakerIdUsable = true;
  }

  public release(): void {
    if (this.released) {
      return;
    }
    this.released = true;
    this.emit({ type: 'released' });
    this.listeners.clear();
    this.ringBuffer.splice(0, this.ringBuffer.length);
  }

  public getSummary(): LiveSpeakerTurnSummary {
    return {
      eventCount: this.eventCount,
      turnCount: this.finalizedTurnCount,
      speakerCount: this.finalizedSpeakerIds.size,
      durationMs: samplesToMs(this.nextSample, this.config.sampleRate),
    };
  }

  private startTurn(startSample: number): void {
    const turnId = `turn_${this.nextTurnIndex}`;
    this.nextTurnIndex += 1;
    this.activeTurnId = turnId;
    this.activeTurnStartSample = startSample;
    this.speechActive = true;
    this.emit({
      type: 'speech_start',
      turnId,
      startMs: samplesToMs(startSample, this.config.sampleRate),
      startSample,
    });
  }

  private async finishTurn(endSample: number): Promise<void> {
    const turnId = this.activeTurnId;
    const startSample = this.activeTurnStartSample;
    if (!turnId || startSample === null) {
      return;
    }

    this.speechActive = false;
    this.activeTurnId = null;
    this.activeTurnStartSample = null;

    const minTurnSamples = msToSamples(
      this.config.minTurnDurationMs ?? DEFAULT_MIN_TURN_DURATION_MS,
      this.config.sampleRate
    );
    const speechPadSamples = msToSamples(
      this.config.speechPadMs ?? 0,
      this.config.sampleRate
    );
    const paddedStartSample = Math.max(0, startSample - speechPadSamples);
    const paddedEndSample = endSample + speechPadSamples;
    const durationSamples = endSample - startSample;

    this.emit({
      type: 'speech_end',
      turnId,
      startMs: samplesToMs(startSample, this.config.sampleRate),
      endMs: samplesToMs(endSample, this.config.sampleRate),
      startSample,
      endSample,
    });

    if (durationSamples < minTurnSamples) {
      this.emit({
        type: 'turn_discarded',
        turnId,
        reason: 'too_short',
        durationMs: samplesToMs(durationSamples, this.config.sampleRate),
      });
      return;
    }

    if (!this.speakerIdUsable) {
      const error =
        'Speaker ID stream is unavailable until the live speaker-turn session is reset';
      this.emit({ type: 'error', turnId, error });
      this.emit({
        type: 'speaker_id_unavailable',
        turnId,
        error,
        recoverable: false,
      });
      this.emitFinalTurn(turnId, startSample, endSample);
      return;
    }

    this.emit({ type: 'speaker_pending', turnId });
    const turnSamples = this.samplesForRange(
      paddedStartSample,
      paddedEndSample
    );
    let processResult: SpeakerIdProcessResult;
    try {
      processResult = await this.config.speakerId.processSamples(
        this.config.sampleRate,
        turnSamples
      );
    } catch (error) {
      await this.handleSpeakerIdFailure(
        turnId,
        error instanceof Error
          ? error.message
          : 'Speaker ID failed while processing turn audio'
      );
      this.emitFinalTurn(turnId, startSample, endSample);
      return;
    }
    if (!processResult.success) {
      await this.handleSpeakerIdFailure(
        turnId,
        processResult.error ?? 'Speaker ID failed while processing turn audio'
      );
      this.emitFinalTurn(turnId, startSample, endSample);
      return;
    }

    let embeddingResult: SpeakerEmbeddingResult;
    try {
      embeddingResult = await this.config.speakerId.computeEmbedding();
    } catch (error) {
      await this.handleSpeakerIdFailure(
        turnId,
        error instanceof Error
          ? error.message
          : 'Speaker ID failed while computing embedding'
      );
      this.emitFinalTurn(turnId, startSample, endSample);
      return;
    }
    if (!embeddingResult.success) {
      await this.handleSpeakerIdFailure(
        turnId,
        embeddingResult.error ?? 'Speaker ID failed while computing embedding'
      );
      this.emitFinalTurn(turnId, startSample, endSample);
      return;
    }

    const assignment = this.assignSpeaker(embeddingResult.embedding);
    this.emit({
      type: 'speaker_resolved',
      turnId,
      speakerId: assignment.speakerId,
      confidence: assignment.confidence,
      provenance: assignment.provenance,
    });
    this.emitFinalTurn(turnId, startSample, endSample, assignment.speakerId);
  }

  private async handleSpeakerIdFailure(
    turnId: string,
    error: string
  ): Promise<void> {
    let recoverable = false;
    let composedError = error;
    if (this.config.speakerId.resetStream) {
      try {
        const reset = await this.config.speakerId.resetStream();
        recoverable = reset.success;
        if (!reset.success && reset.error) {
          composedError = `${composedError}; speaker stream reset failed: ${reset.error}`;
        }
      } catch (resetError) {
        const resetMessage =
          resetError instanceof Error ? resetError.message : String(resetError);
        composedError = `${composedError}; speaker stream reset failed: ${resetMessage}`;
      }
    }

    if (!recoverable) {
      this.speakerIdUsable = false;
    }

    this.emit({ type: 'error', turnId, error: composedError });
    this.emit({
      type: 'speaker_id_unavailable',
      turnId,
      error: composedError,
      recoverable,
    });
  }

  private emitFinalTurn(
    turnId: string,
    startSample: number,
    endSample: number,
    speakerId?: string
  ): void {
    this.emit({
      type: 'turn_final',
      turnId,
      startMs: samplesToMs(startSample, this.config.sampleRate),
      endMs: samplesToMs(endSample, this.config.sampleRate),
      startSample,
      endSample,
      speakerId,
    });
  }

  private assignSpeaker(embedding: number[]): {
    speakerId: string;
    confidence: number;
    provenance: LiveSpeakerTurnProvenance;
  } {
    const normalizedEmbedding = normalizeEmbedding(embedding);
    let bestMatch: LiveSpeakerTurnSpeakerCentroid | null = null;
    let bestScore = -Infinity;

    for (const centroid of this.centroids) {
      const score = cosineSimilarity(normalizedEmbedding, centroid.embedding);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = centroid;
      }
    }

    const threshold = this.config.speakerThreshold ?? DEFAULT_SPEAKER_THRESHOLD;
    if (bestMatch && bestScore >= threshold) {
      bestMatch.turnCount += 1;
      if (this.config.centroidUpdate !== 'none') {
        const alpha =
          this.config.centroidUpdateAlpha ?? DEFAULT_CENTROID_UPDATE_ALPHA;
        bestMatch.embedding = movingAverageCentroid(
          bestMatch.embedding,
          normalizedEmbedding,
          alpha
        );
      }
      return {
        speakerId: bestMatch.speakerId,
        confidence: bestScore,
        provenance: 'centroid_match',
      };
    }

    const maxSpeakers = this.config.maxSpeakers;
    if (
      typeof maxSpeakers === 'number' &&
      maxSpeakers > 0 &&
      this.centroids.length >= maxSpeakers &&
      bestMatch
    ) {
      return {
        speakerId: bestMatch.speakerId,
        confidence: bestScore,
        provenance: 'forced_fallback',
      };
    }

    const speakerId = `speaker_${this.nextSpeakerIndex}`;
    this.nextSpeakerIndex += 1;
    this.centroids.push({
      speakerId,
      embedding: normalizedEmbedding,
      turnCount: 1,
    });
    return {
      speakerId,
      confidence: 1,
      provenance: 'new_speaker',
    };
  }

  private appendToRingBuffer(startSample: number, samples: number[]): void {
    if (samples.length === 0) {
      return;
    }
    this.ringBuffer.push({ startSample, samples });
    const latestSample = startSample + samples.length;
    const maxBufferSamples = msToSamples(
      this.config.maxRingBufferDurationMs ??
        DEFAULT_MAX_RING_BUFFER_DURATION_MS,
      this.config.sampleRate
    );
    const oldestAllowedSample = Math.max(0, latestSample - maxBufferSamples);
    while (this.ringBuffer.length > 0) {
      const firstChunk = this.ringBuffer[0];
      if (!firstChunk) {
        return;
      }
      const firstChunkEnd = firstChunk.startSample + firstChunk.samples.length;
      if (firstChunkEnd >= oldestAllowedSample) {
        return;
      }
      this.ringBuffer.shift();
    }
  }

  private samplesForRange(startSample: number, endSample: number): number[] {
    const output: number[] = [];
    for (const chunk of this.ringBuffer) {
      const chunkStart = chunk.startSample;
      const chunkEnd = chunk.startSample + chunk.samples.length;
      const overlapStart = Math.max(startSample, chunkStart);
      const overlapEnd = Math.min(endSample, chunkEnd);
      if (overlapStart >= overlapEnd) {
        continue;
      }
      output.push(
        ...chunk.samples.slice(
          overlapStart - chunkStart,
          overlapEnd - chunkStart
        )
      );
    }
    return output;
  }

  private emit(event: LiveSpeakerTurnEvent): void {
    this.eventCount += 1;
    if (event.type === 'turn_final') {
      this.finalizedTurnCount += 1;
      if (event.speakerId) {
        this.finalizedSpeakerIds.add(event.speakerId);
      }
    }
    this.emittedEvents.push(cloneEvent(event));
    const maxStoredEvents = Math.max(
      0,
      Math.floor(this.config.maxStoredEvents ?? DEFAULT_MAX_STORED_EVENTS)
    );
    if (this.emittedEvents.length > maxStoredEvents) {
      this.emittedEvents.splice(0, this.emittedEvents.length - maxStoredEvents);
    }
    for (const listener of this.listeners) {
      listener(cloneEvent(event));
    }
  }

  private ensureNotReleased(): void {
    if (this.released) {
      throw new Error('LiveSpeakerTurnSession has been released');
    }
  }
}
