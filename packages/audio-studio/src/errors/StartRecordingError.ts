/**
 * Stable typed reasons `startRecording` can fail.
 *
 * On iOS every failure previously surfaced as the single message
 * "Failed to start recording.", so a caller could not distinguish an active phone call
 * from a file that could not be created (#419). iOS now reports the same codes Android
 * has always emitted, so this vocabulary is shared rather than per-platform.
 */
export type StartRecordingErrorCode =
    /** A recording is already running. */
    | 'ALREADY_RECORDING'
    /** A phone call is active. */
    | 'ONGOING_CALL'
    /** The output file could not be created, or the audio session would not configure. */
    | 'FILE_CREATION_FAILED'
    /** Audio focus could not be obtained. Android only. */
    | 'AUDIO_FOCUS_ERROR'
    /** The compressed recorder could not be initialised. Android only. */
    | 'COMPRESSED_INIT_FAILED'
    /** The compressed recorder could not be started. Android only. */
    | 'COMPRESSED_START_FAILED'
    /** Microphone permission was not granted. Android only. */
    | 'PERMISSION_DENIED'
    /** Notification permission was not granted while notifications were requested. Android only. */
    | 'NOTIFICATION_PERMISSION_DENIED'
    /** No supported audio format was found for the requested configuration. Android only. */
    | 'INITIALIZATION_FAILED'
    /** A usable buffer size could not be determined. Android only. */
    | 'BUFFER_SIZE_ERROR'
    /** Recording could not start for a reason with no more specific code. */
    | 'START_FAILED'
    /** An unexpected error escaped the native layer. */
    | 'UNEXPECTED_ERROR'

/** Codes worth retrying once the blocking condition clears. */
const RECOVERABLE: StartRecordingErrorCode[] = [
    'ONGOING_CALL',
    'ALREADY_RECORDING',
    'AUDIO_FOCUS_ERROR',
    // Retryable only after the user grants the permission; the caller decides when.
    'PERMISSION_DENIED',
    'NOTIFICATION_PERMISSION_DENIED',
]

const KNOWN_CODES = new Set<string>([
    'ALREADY_RECORDING',
    'ONGOING_CALL',
    'FILE_CREATION_FAILED',
    'AUDIO_FOCUS_ERROR',
    'COMPRESSED_INIT_FAILED',
    'COMPRESSED_START_FAILED',
    'PERMISSION_DENIED',
    'NOTIFICATION_PERMISSION_DENIED',
    'INITIALIZATION_FAILED',
    'BUFFER_SIZE_ERROR',
    'START_FAILED',
    'UNEXPECTED_ERROR',
])

export const isStartRecordingErrorCode = (
    value: unknown
): value is StartRecordingErrorCode =>
    typeof value === 'string' && KNOWN_CODES.has(value)

export const isRecoverableStartRecordingError = (
    code: StartRecordingErrorCode
): boolean => RECOVERABLE.includes(code)

/**
 * Narrows an unknown rejection from `startRecording` to a typed code.
 *
 * Anything unrecognised — including older native builds that still reject with a generic
 * code — becomes `START_FAILED`, so callers can switch exhaustively without a default
 * that silently swallows new reasons.
 */
export const startRecordingErrorCode = (
    error: unknown
): StartRecordingErrorCode => {
    const code = (error as { code?: unknown } | null)?.code
    return isStartRecordingErrorCode(code) ? code : 'START_FAILED'
}
