import type {
  LiveAttributedTranscriptionConfig,
  LiveAttributedTranscriptionEvent,
  LiveAttributedTranscriptionEventListener,
  LiveAttributedTranscriptionState,
  LiveAttributedTranscriptionSummary,
  LiveSpeakerTurnEvent,
  LiveTranscriptSegment,
  LiveTranscriptionChunk,
} from '../types/interfaces';

function samplesToMs(samples: number, sampleRate: number): number {
  return (samples / sampleRate) * 1000;
}

function cloneSegment(segment: LiveTranscriptSegment): LiveTranscriptSegment {
  return { ...segment };
}

/**
 * Live attributed transcription composer.
 *
 * This class owns the replayable event contract that joins online ASR output
 * with `LiveSpeakerTurnSession` speaker-turn events. It intentionally keeps
 * initialization/model loading outside the class so apps can decide which ASR,
 * VAD, and Speaker ID models to use and can reuse already-initialized services.
 */
export class LiveAttributedTranscriptionSession {
  private readonly config: LiveAttributedTranscriptionConfig;
  private readonly listeners = new Set<LiveAttributedTranscriptionEventListener>();
  private readonly emittedEvents: LiveAttributedTranscriptionEvent[] = [];
  private readonly segments = new Map<string, LiveTranscriptSegment>();
  private readonly segmentOrder: string[] = [];
  private readonly turnSpeakers = new Map<
    string,
    { speakerId: string; confidence: number }
  >();
  private readonly turnSegments = new Map<string, Set<string>>();
  private readonly unsubscribeSpeakerEvents: () => void;
  private readonly pendingFinalTurns: Extract<
    LiveSpeakerTurnEvent,
    { type: 'turn_final' }
  >[] = [];
  private nextSample = 0;
  private nextSegmentIndex = 1;
  private currentSegmentId: string | null = null;
  private currentSegmentStartSample = 0;
  private activeTurnId: string | undefined;
  private released = false;

  constructor(config: LiveAttributedTranscriptionConfig) {
    if (!Number.isFinite(config.sampleRate) || config.sampleRate <= 0) {
      throw new Error(
        'LiveAttributedTranscriptionSession requires a positive sampleRate'
      );
    }
    this.config = config;
    if (config.onEvent) {
      this.listeners.add(config.onEvent);
    }
    this.unsubscribeSpeakerEvents = config.speakerTurns.onEvent((event) => {
      this.handleSpeakerEvent(event);
    });
  }

  public onEvent(listener: LiveAttributedTranscriptionEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): LiveAttributedTranscriptionState {
    return {
      released: this.released,
      nextSample: this.nextSample,
      activeTurnId: this.activeTurnId,
      activeSegmentId: this.currentSegmentId ?? undefined,
      segments: this.getOrderedSegments(),
      events: [...this.emittedEvents],
    };
  }

  public getSummary(): LiveAttributedTranscriptionSummary {
    const segments = this.getOrderedSegments();
    return {
      eventCount: this.emittedEvents.length,
      segmentCount: segments.length,
      finalSegmentCount: segments.filter((segment) => segment.final).length,
      speakerAttributedSegmentCount: segments.filter((segment) =>
        Boolean(segment.speakerId)
      ).length,
      durationMs: samplesToMs(this.nextSample, this.config.sampleRate),
    };
  }

  public async acceptChunk(chunk: LiveTranscriptionChunk): Promise<void> {
    this.ensureNotReleased();

    const sampleRate = chunk.sampleRate ?? this.config.sampleRate;
    if (sampleRate !== this.config.sampleRate) {
      throw new Error(
        `LiveAttributedTranscriptionSession expected sampleRate ${this.config.sampleRate}, received ${sampleRate}`
      );
    }

    const startSample = chunk.startSample ?? this.nextSample;
    if (startSample < this.nextSample) {
      throw new Error(
        `LiveAttributedTranscriptionSession received non-monotonic startSample ${startSample}; next expected sample is ${this.nextSample}`
      );
    }

    const samples = Array.from(chunk.samples);
    this.nextSample = startSample + samples.length;

    await this.config.speakerTurns.acceptChunk({
      samples,
      sampleRate,
      startSample,
    });

    const accepted = await this.config.asr.acceptWaveform(sampleRate, samples);
    if (!accepted.success) {
      this.emit({
        type: 'error',
        source: 'asr',
        error: accepted.error ?? 'ASR failed while accepting waveform',
      });
      return;
    }

    const result = await this.config.asr.getResult();
    const text = result.text.trim();
    if (text.length > 0) {
      this.emitPartial(text, startSample, this.nextSample);
    }

    const endpoint = await this.config.asr.isEndpoint();
    if (endpoint.isEndpoint) {
      await this.finalizeCurrentSegment(this.nextSample);
      const reset = await this.config.asr.resetStream();
      if (!reset.success) {
        this.emit({
          type: 'error',
          source: 'asr',
          error: reset.error ?? 'ASR failed while resetting online stream',
        });
      }
    }

    this.emitPendingFinalTurns();
  }

  public async flush(): Promise<void> {
    this.ensureNotReleased();
    await this.config.speakerTurns.flush();
    await this.finalizeCurrentSegment(this.nextSample);
    this.emitPendingFinalTurns();
  }

  public async reset(): Promise<void> {
    this.ensureNotReleased();
    await this.config.speakerTurns.reset();
    const reset = await this.config.asr.resetStream();
    if (!reset.success) {
      this.emit({
        type: 'error',
        source: 'asr',
        error: reset.error ?? 'ASR failed while resetting online stream',
      });
    }
    this.emittedEvents.splice(0, this.emittedEvents.length);
    this.segments.clear();
    this.segmentOrder.splice(0, this.segmentOrder.length);
    this.turnSpeakers.clear();
    this.turnSegments.clear();
    this.pendingFinalTurns.splice(0, this.pendingFinalTurns.length);
    this.nextSample = 0;
    this.nextSegmentIndex = 1;
    this.currentSegmentId = null;
    this.currentSegmentStartSample = 0;
    this.activeTurnId = undefined;
  }

  public release(): void {
    if (this.released) {
      return;
    }
    this.released = true;
    this.unsubscribeSpeakerEvents();
    this.config.speakerTurns.release();
    this.emit({ type: 'released' });
    this.listeners.clear();
  }

  private handleSpeakerEvent(event: LiveSpeakerTurnEvent): void {
    if (this.released) {
      return;
    }

    if (event.type === 'speech_start') {
      this.activeTurnId = event.turnId;
      this.ensureCurrentSegment(event.startSample);
      this.attachSegmentToTurn(this.currentSegmentId, event.turnId);
    }

    if (event.type === 'speaker_resolved') {
      this.turnSpeakers.set(event.turnId, {
        speakerId: event.speakerId,
        confidence: event.confidence,
      });
      const affectedSegmentIds = this.applySpeakerToTurnSegments(
        event.turnId,
        event.speakerId
      );
      if (affectedSegmentIds.length > 0) {
        this.emit({
          type: 'transcript_speaker_update',
          turnId: event.turnId,
          speakerId: event.speakerId,
          confidence: event.confidence,
          affectedSegmentIds,
        });
      }
    }

    if (event.type === 'turn_final') {
      this.pendingFinalTurns.push(event);
      if (this.activeTurnId === event.turnId) {
        this.activeTurnId = undefined;
      }
    }

    if (event.type === 'error') {
      this.emit({
        type: 'error',
        source: 'speaker_turn',
        error: event.error,
      });
    }

    this.emit({ type: 'speaker_event', event });
  }

  private emitPartial(
    text: string,
    startSample: number,
    endSample: number
  ): void {
    const segment = this.ensureCurrentSegment(startSample);
    const unchanged = segment.text === text && !segment.final;
    segment.text = text;
    segment.endSample = endSample;
    segment.endMs = samplesToMs(endSample, this.config.sampleRate);
    if (this.activeTurnId) {
      segment.turnId = this.activeTurnId;
      this.attachSegmentToTurn(segment.segmentId, this.activeTurnId);
      const speaker = this.turnSpeakers.get(this.activeTurnId);
      if (speaker) {
        segment.speakerId = speaker.speakerId;
      }
    }
    if (!unchanged || this.config.emitUnchangedPartials) {
      this.emit({
        type: 'partial_transcript',
        segmentId: segment.segmentId,
        turnId: segment.turnId,
        text: segment.text,
        startMs: segment.startMs,
        endMs: segment.endMs,
        startSample: segment.startSample,
        endSample: segment.endSample,
        speakerId: segment.speakerId,
      });
    }
  }

  private async finalizeCurrentSegment(endSample: number): Promise<void> {
    const segmentId = this.currentSegmentId;
    if (!segmentId) {
      return;
    }
    const segment = this.segments.get(segmentId);
    if (!segment || segment.text.trim().length === 0 || segment.final) {
      this.currentSegmentId = null;
      this.currentSegmentStartSample = endSample;
      return;
    }

    segment.final = true;
    segment.endSample = endSample;
    segment.endMs = samplesToMs(endSample, this.config.sampleRate);
    if (segment.turnId) {
      const speaker = this.turnSpeakers.get(segment.turnId);
      if (speaker) {
        segment.speakerId = speaker.speakerId;
      }
    }
    this.emit({
      type: 'final_transcript',
      segmentId: segment.segmentId,
      turnId: segment.turnId,
      text: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
      startSample: segment.startSample,
      endSample: segment.endSample,
      speakerId: segment.speakerId,
    });
    this.currentSegmentId = null;
    this.currentSegmentStartSample = endSample;
  }

  private ensureCurrentSegment(startSample: number): LiveTranscriptSegment {
    if (this.currentSegmentId) {
      const existing = this.segments.get(this.currentSegmentId);
      if (existing && !existing.final) {
        return existing;
      }
    }

    const segmentId = `segment_${this.nextSegmentIndex}`;
    this.nextSegmentIndex += 1;
    const effectiveStartSample = Math.max(
      this.currentSegmentStartSample,
      startSample
    );
    const segment: LiveTranscriptSegment = {
      segmentId,
      turnId: this.activeTurnId,
      text: '',
      final: false,
      startSample: effectiveStartSample,
      endSample: effectiveStartSample,
      startMs: samplesToMs(effectiveStartSample, this.config.sampleRate),
      endMs: samplesToMs(effectiveStartSample, this.config.sampleRate),
    };
    const speaker = segment.turnId
      ? this.turnSpeakers.get(segment.turnId)
      : undefined;
    if (speaker) {
      segment.speakerId = speaker.speakerId;
    }
    this.segments.set(segmentId, segment);
    this.segmentOrder.push(segmentId);
    this.currentSegmentId = segmentId;
    if (segment.turnId) {
      this.attachSegmentToTurn(segmentId, segment.turnId);
    }
    return segment;
  }

  private attachSegmentToTurn(
    segmentId: string | null,
    turnId: string | undefined
  ): void {
    if (!segmentId || !turnId) {
      return;
    }
    let segmentIds = this.turnSegments.get(turnId);
    if (!segmentIds) {
      segmentIds = new Set<string>();
      this.turnSegments.set(turnId, segmentIds);
    }
    segmentIds.add(segmentId);
  }

  private applySpeakerToTurnSegments(
    turnId: string,
    speakerId: string
  ): string[] {
    const segmentIds = this.turnSegments.get(turnId);
    if (!segmentIds) {
      return [];
    }
    const affected: string[] = [];
    for (const segmentId of segmentIds) {
      const segment = this.segments.get(segmentId);
      if (!segment || segment.speakerId === speakerId) {
        continue;
      }
      segment.speakerId = speakerId;
      affected.push(segmentId);
    }
    return affected;
  }

  private emitPendingFinalTurns(): void {
    while (this.pendingFinalTurns.length > 0) {
      const event = this.pendingFinalTurns.shift();
      if (!event) {
        continue;
      }
      const segmentIds = Array.from(
        this.turnSegments.get(event.turnId) ?? new Set<string>()
      );
      const text = segmentIds
        .map((segmentId) => this.segments.get(segmentId)?.text ?? '')
        .join(' ')
        .trim();
      this.emit({
        type: 'turn_finalized',
        turnId: event.turnId,
        startMs: event.startMs,
        endMs: event.endMs,
        startSample: event.startSample,
        endSample: event.endSample,
        speakerId: event.speakerId,
        segmentIds,
        text,
      });
    }
  }

  private getOrderedSegments(): LiveTranscriptSegment[] {
    return this.segmentOrder
      .map((segmentId) => this.segments.get(segmentId))
      .filter((segment): segment is LiveTranscriptSegment => Boolean(segment))
      .map(cloneSegment);
  }

  private emit(event: LiveAttributedTranscriptionEvent): void {
    this.emittedEvents.push(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private ensureNotReleased(): void {
    if (this.released) {
      throw new Error('LiveAttributedTranscriptionSession has been released');
    }
  }
}
