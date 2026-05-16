import type {
  SegmentedOfflineAsrChunk,
  SegmentedOfflineAsrConfig,
  SegmentedOfflineAsrEvent,
  SegmentedOfflineAsrEventListener,
  SegmentedOfflineAsrSegment,
  SegmentedOfflineAsrState,
  SegmentedOfflineAsrSummary,
} from '../types/interfaces';

const DEFAULT_SEGMENT_DURATION_MS = 30_000;
const DEFAULT_MAX_STORED_EVENTS = 1000;

function samplesToMs(samples: number, sampleRate: number): number {
  return (samples / sampleRate) * 1000;
}

function cloneSegment(
  segment: SegmentedOfflineAsrSegment
): SegmentedOfflineAsrSegment {
  return {
    ...segment,
    tokens: segment.tokens ? [...segment.tokens] : undefined,
    timestamps: segment.timestamps ? [...segment.timestamps] : undefined,
  };
}

function cloneEvent(event: SegmentedOfflineAsrEvent): SegmentedOfflineAsrEvent {
  switch (event.type) {
    case 'segment_completed':
      return { ...event, segment: cloneSegment(event.segment) };
    default:
      return { ...event };
  }
}

/**
 * Bounded-memory helper for offline-only ASR models.
 *
 * Sherpa offline models such as Qwen3, Whisper, SenseVoice, and Canary do not
 * expose an online `acceptWaveform/getResult` contract. This JS session wraps
   * those offline recognizers by buffering decoded PCM into fixed-size windows,
   * materializing only the current window as `number[]`, and emitting stable
   * progress/segment events while callers keep decoding long audio incrementally.
 *
 * Calls are intentionally single-flight: await each `acceptChunk()` / `flush()`
 * before submitting the next chunk so segment boundaries and model cleanup stay
 * deterministic.
 */
export class SegmentedOfflineAsrSession {
  private readonly config: Required<
    Pick<SegmentedOfflineAsrConfig, 'segmentDurationMs' | 'overlapMs'>
  > &
    Omit<SegmentedOfflineAsrConfig, 'segmentDurationMs' | 'overlapMs'>;
  private readonly listeners = new Set<SegmentedOfflineAsrEventListener>();
  private readonly emittedEvents: SegmentedOfflineAsrEvent[] = [];
  private readonly maxStoredEvents: number;
  private readonly chunks: Float32Array[] = [];
  private readonly segments: SegmentedOfflineAsrSegment[] = [];
  private bufferedSamples = 0;
  private bufferStartSample = 0;
  private nextSample = 0;
  private processedSamples = 0;
  private transcript = '';
  private released = false;

  constructor(config: SegmentedOfflineAsrConfig) {
    const segmentDurationMs =
      config.segmentDurationMs ?? DEFAULT_SEGMENT_DURATION_MS;
    const overlapMs = config.overlapMs ?? 0;

    if (!Number.isFinite(config.sampleRate) || config.sampleRate <= 0) {
      throw new Error('SegmentedOfflineAsrSession requires a positive sampleRate');
    }
    if (!Number.isFinite(segmentDurationMs) || segmentDurationMs <= 0) {
      throw new Error(
        'SegmentedOfflineAsrSession requires a positive segmentDurationMs'
      );
    }
    if (!Number.isFinite(overlapMs) || overlapMs < 0) {
      throw new Error('SegmentedOfflineAsrSession requires overlapMs >= 0');
    }
    if (overlapMs >= segmentDurationMs) {
      throw new Error(
        'SegmentedOfflineAsrSession requires overlapMs to be smaller than segmentDurationMs'
      );
    }

    this.config = {
      ...config,
      segmentDurationMs,
      overlapMs,
    };
    this.maxStoredEvents = config.maxStoredEvents ?? DEFAULT_MAX_STORED_EVENTS;
    if (config.onEvent) {
      this.listeners.add(config.onEvent);
    }
  }

  public onEvent(listener: SegmentedOfflineAsrEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): SegmentedOfflineAsrState {
    return {
      released: this.released,
      nextSample: this.nextSample,
      bufferedSamples: this.bufferedSamples,
      processedSamples: this.processedSamples,
      segmentCount: this.segments.length,
      transcript: this.transcript,
      segments: this.segments.map(cloneSegment),
      events: this.emittedEvents.map(cloneEvent),
    };
  }

  public getSummary(): SegmentedOfflineAsrSummary {
    return {
      durationMs: samplesToMs(this.nextSample, this.config.sampleRate),
      bufferedMs: samplesToMs(this.bufferedSamples, this.config.sampleRate),
      processedMs: samplesToMs(this.processedSamples, this.config.sampleRate),
      segmentCount: this.segments.length,
      transcriptCharCount: this.transcript.length,
    };
  }

  public async acceptChunk(chunk: SegmentedOfflineAsrChunk): Promise<void> {
    this.ensureNotReleased();
    const sampleRate = chunk.sampleRate ?? this.config.sampleRate;
    if (sampleRate !== this.config.sampleRate) {
      throw new Error(
        `SegmentedOfflineAsrSession expected sampleRate ${this.config.sampleRate}, received ${sampleRate}`
      );
    }

    const startSample = chunk.startSample ?? this.nextSample;
    if (startSample !== this.nextSample) {
      throw new Error(
        `SegmentedOfflineAsrSession received non-contiguous startSample ${startSample}; next expected sample is ${this.nextSample}`
      );
    }

    const samples = Float32Array.from(chunk.samples);
    if (samples.length > 0) {
      this.chunks.push(samples);
      this.bufferedSamples += samples.length;
      this.nextSample += samples.length;
    }

    try {
      if (chunk.isFinal) {
        await this.flushReadySegmentsForFinalInput();
        await this.flush(true);
      } else {
        await this.flushReadySegments();
        this.emitProgress();
      }
    } catch (error) {
      this.emit({
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  public async flush(final = true): Promise<void> {
    this.ensureNotReleased();
    if (this.bufferedSamples <= 0) return;
    if (
      final &&
      this.segments.length > 0 &&
      this.overlapSamples > 0 &&
      this.bufferedSamples <= this.overlapSamples
    ) {
      // The retained overlap has already been included in the previous
      // recognition window, so do not emit a duplicate final segment for it.
      this.consumeSamples(this.bufferedSamples);
      this.emitProgress();
      return;
    }
    await this.recognizeBufferedSegment(
      final ? this.bufferedSamples : this.segmentSamples,
      final
    );
    this.emitProgress();
  }

  public reset(): void {
    this.ensureNotReleased();
    this.chunks.length = 0;
    this.segments.length = 0;
    this.emittedEvents.length = 0;
    this.bufferedSamples = 0;
    this.bufferStartSample = 0;
    this.nextSample = 0;
    this.processedSamples = 0;
    this.transcript = '';
  }

  public release(): void {
    if (this.released) return;
    this.released = true;
    this.chunks.length = 0;
    this.emit({ type: 'released' });
    this.listeners.clear();
  }

  private get segmentSamples(): number {
    return Math.max(
      1,
      Math.floor((this.config.segmentDurationMs / 1000) * this.config.sampleRate)
    );
  }

  private get overlapSamples(): number {
    return Math.max(
      0,
      Math.floor((this.config.overlapMs / 1000) * this.config.sampleRate)
    );
  }

  private async flushReadySegments(): Promise<void> {
    while (this.bufferedSamples >= this.segmentSamples) {
      await this.recognizeBufferedSegment(this.segmentSamples, false);
    }
  }

  private async flushReadySegmentsForFinalInput(): Promise<void> {
    while (this.bufferedSamples > this.segmentSamples) {
      await this.recognizeBufferedSegment(this.segmentSamples, false);
    }
  }

  private async recognizeBufferedSegment(
    sampleCount: number,
    final: boolean
  ): Promise<void> {
    if (sampleCount <= 0 || this.bufferedSamples <= 0) return;
    const actualSampleCount = Math.min(sampleCount, this.bufferedSamples);
    const segmentIndex = this.segments.length + 1;
    const startSample = this.bufferStartSample;
    const endSample = startSample + actualSampleCount;
    const startedEvent = {
      type: 'segment_started' as const,
      segmentIndex,
      startSample,
      endSample,
      startMs: samplesToMs(startSample, this.config.sampleRate),
      endMs: samplesToMs(endSample, this.config.sampleRate),
      sampleCount: actualSampleCount,
      final,
    };
    this.emit(startedEvent);

    const samples = this.materializeSamples(actualSampleCount);
    const startedAt = Date.now();
    const result = await this.config.asr.recognizeFromSamples(
      this.config.sampleRate,
      samples
    );
    const recognizeMs = Date.now() - startedAt;

    if (!result.success) {
      const error =
        result.error ?? `Offline ASR failed for segment ${segmentIndex}`;
      this.emit({ type: 'error', error, segmentIndex });
      throw new Error(error);
    }

    if (this.released) {
      return;
    }

    const segment: SegmentedOfflineAsrSegment = {
      segmentIndex,
      startSample,
      endSample,
      startMs: startedEvent.startMs,
      endMs: startedEvent.endMs,
      sampleCount: actualSampleCount,
      final,
      text: String(result.text ?? '').trim(),
      recognizeMs,
      tokens: result.tokens ? [...result.tokens] : undefined,
      timestamps: result.timestamps ? [...result.timestamps] : undefined,
    };
    this.segments.push(segment);
    if (segment.text) {
      this.transcript = this.transcript
        ? `${this.transcript} ${segment.text}`
        : segment.text;
    }
    this.processedSamples = Math.max(this.processedSamples, endSample);

    const consumedSamples = final
      ? actualSampleCount
      : Math.max(1, actualSampleCount - this.overlapSamples);
    this.consumeSamples(consumedSamples);

    this.emit({
      type: 'segment_completed',
      segment: cloneSegment(segment),
      transcript: this.transcript,
      transcriptCharCount: this.transcript.length,
      segmentCount: this.segments.length,
    });

    if (!final && this.config.afterSegment) {
      await this.config.afterSegment(cloneSegment(segment));
    }
  }

  private materializeSamples(sampleCount: number): number[] {
    const output = new Array<number>(sampleCount);
    let written = 0;
    for (const chunk of this.chunks) {
      const copyCount = Math.min(chunk.length, sampleCount - written);
      for (let index = 0; index < copyCount; index += 1) {
        output[written + index] = chunk[index] ?? 0;
      }
      written += copyCount;
      if (written >= sampleCount) break;
    }
    return output;
  }

  private consumeSamples(sampleCount: number): void {
    let remaining = Math.min(sampleCount, this.bufferedSamples);
    while (remaining > 0 && this.chunks.length > 0) {
      const first = this.chunks[0]!;
      if (remaining >= first.length) {
        this.chunks.shift();
        this.bufferStartSample += first.length;
        this.bufferedSamples -= first.length;
        remaining -= first.length;
      } else {
        this.chunks[0] = first.slice(remaining);
        this.bufferStartSample += remaining;
        this.bufferedSamples -= remaining;
        remaining = 0;
      }
    }
  }

  private emitProgress(): void {
    this.emit({
      type: 'progress',
      bufferedMs: samplesToMs(this.bufferedSamples, this.config.sampleRate),
      processedMs: samplesToMs(this.processedSamples, this.config.sampleRate),
      segmentCount: this.segments.length,
      transcriptCharCount: this.transcript.length,
    });
  }

  private emit(event: SegmentedOfflineAsrEvent): void {
    this.emittedEvents.push(cloneEvent(event));
    if (this.emittedEvents.length > this.maxStoredEvents) {
      this.emittedEvents.splice(
        0,
        this.emittedEvents.length - this.maxStoredEvents
      );
    }
    for (const listener of this.listeners) {
      try {
        listener(cloneEvent(event));
      } catch (error) {
        console.warn(
          '[SegmentedOfflineAsrSession] Ignoring listener error:',
          error
        );
      }
    }
  }

  private ensureNotReleased(): void {
    if (this.released) {
      throw new Error('SegmentedOfflineAsrSession has been released');
    }
  }
}
