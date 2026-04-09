import type { MoonshineAbortSignal } from '../types/interfaces';
import { MOONSHINE_TRANSCRIPTION_CANCELLED_CODE } from '../types/interfaces';

export function createMoonshineAbortError(
  reason?: unknown
): Error & { code: string } {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : 'Moonshine transcription cancelled';
  const error = new Error(message) as Error & { code: string; name: string };
  error.code = MOONSHINE_TRANSCRIPTION_CANCELLED_CODE;
  error.name = 'AbortError';
  return error;
}

export async function runWithAbortSignal<T>({
  cancel,
  onFinally,
  signal,
  run,
}: {
  cancel: () => Promise<unknown>;
  onFinally?: (outcome: 'resolved' | 'rejected') => void;
  signal: MoonshineAbortSignal | undefined;
  run: () => Promise<T>;
}): Promise<T> {
  if (!signal) {
    try {
      const result = await run();
      onFinally?.('resolved');
      return result;
    } catch (error) {
      onFinally?.('rejected');
      throw error;
    }
  }

  if (signal.aborted) {
    throw createMoonshineAbortError(signal.reason);
  }

  let abortRequested = false;
  const onAbort = () => {
    if (abortRequested) {
      return;
    }
    abortRequested = true;
    cancel().catch(() => undefined);
  };

  signal.addEventListener?.('abort', onAbort, { once: true });
  try {
    const result = await run();
    onFinally?.('resolved');
    return result;
  } catch (error) {
    onFinally?.('rejected');
    if (
      abortRequested &&
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code ===
        MOONSHINE_TRANSCRIPTION_CANCELLED_CODE
    ) {
      throw createMoonshineAbortError(signal.reason);
    }
    throw error;
  } finally {
    signal.removeEventListener?.('abort', onAbort);
  }
}
