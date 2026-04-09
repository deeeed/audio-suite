import type { MoonshineTranscriptEvent } from '../types/interfaces';

type OfflineProgressState = {
  enabled: boolean;
  lastProgress: number;
  sawNativeProgress: boolean;
  totalDurationMs: number;
};

export class OfflineProgressTracker {
  private readonly progressByTranscriber = new Map<
    string,
    OfflineProgressState
  >();

  public begin(
    transcriberId: string,
    sampleRate: number,
    sampleCount: number,
    enabled: boolean
  ): void {
    if (!enabled || sampleRate <= 0) {
      this.progressByTranscriber.delete(transcriberId);
      return;
    }

    this.progressByTranscriber.set(transcriberId, {
      enabled: true,
      lastProgress: 0,
      sawNativeProgress: false,
      totalDurationMs: (sampleCount / sampleRate) * 1000,
    });
  }

  public finish(
    transcriberId: string,
    completed: boolean
  ): MoonshineTranscriptEvent | null {
    const state = this.progressByTranscriber.get(transcriberId);
    if (!state) {
      return null;
    }

    this.progressByTranscriber.delete(transcriberId);

    if (!completed || state.sawNativeProgress || state.lastProgress >= 1) {
      return null;
    }

    return {
      processedDurationMs: state.totalDurationMs,
      progress: 1,
      streamId: `${transcriberId}:offline`,
      totalDurationMs: state.totalDurationMs,
      transcriberId,
      type: 'transcriptionProgress',
    };
  }

  public observe(
    event: MoonshineTranscriptEvent
  ): MoonshineTranscriptEvent | null {
    const state = this.progressByTranscriber.get(event.transcriberId);
    if (!state?.enabled) {
      return null;
    }

    if (event.type === 'transcriptionProgress') {
      state.sawNativeProgress = true;
      state.lastProgress = Math.max(state.lastProgress, event.progress ?? 0);
      return null;
    }

    if (state.sawNativeProgress || !event.line) {
      return null;
    }

    const processedDurationMs =
      event.line.completedAtMs ??
      (event.line.startedAtMs ?? 0) + (event.line.durationMs ?? 0);
    if (!Number.isFinite(processedDurationMs) || state.totalDurationMs <= 0) {
      return null;
    }

    const progress = Math.min(
      Math.max(processedDurationMs / state.totalDurationMs, state.lastProgress),
      1
    );
    if (progress <= state.lastProgress && event.type !== 'lineCompleted') {
      return null;
    }

    state.lastProgress = progress;
    return {
      processedDurationMs,
      progress,
      streamId: event.streamId,
      totalDurationMs: state.totalDurationMs,
      transcriberId: event.transcriberId,
      type: 'transcriptionProgress',
    };
  }
}
