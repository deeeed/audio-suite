/**
 * Stable typed reasons `startRecording` can fail.
 *
 * On iOS every failure previously surfaced as the single message
 * "Failed to start recording.", so a caller could not distinguish an active phone call
 * from a file that could not be created (#419). iOS now reports the same codes Android
 * has always emitted, so this vocabulary is shared rather than per-platform.
 */

/**
 * Every code the native layers can reject `startRecording` with.
 *
 * Single source of truth: the union, the runtime guard, and the tests all derive from
 * this list. An earlier version maintained the union and a separate `Set` by hand, and a
 * test claiming to cover "every documented code" passed while four real codes were
 * missing from both.
 *
 *  - `ALREADY_RECORDING`            a recording is already running
 *  - `ONGOING_CALL`                 a phone call is active
 *  - `FILE_CREATION_FAILED`         the output file could not be created or opened
 *  - `INVALID_SETTINGS`             settings were rejected during validation (iOS)
 *  - `INVALID_CONFIG`               config was rejected during validation (Android)
 *  - `PERMISSION_DENIED`            microphone permission was not granted
 *  - `NOTIFICATION_PERMISSION_DENIED` notification permission was not granted (Android)
 *  - `AUDIO_FOCUS_ERROR`            audio focus could not be obtained (Android)
 *  - `INITIALIZATION_FAILED`        no supported audio format for the request (Android)
 *  - `BUFFER_SIZE_ERROR`            no usable buffer size (Android)
 *  - `COMPRESSED_INIT_FAILED`       the compressed recorder would not initialise (Android)
 *  - `COMPRESSED_START_FAILED`      the compressed recorder would not start (Android)
 *  - `START_FAILED`                 no more specific reason is available
 *  - `UNEXPECTED_ERROR`             an unexpected error escaped the native layer
 */
export const START_RECORDING_ERROR_CODES = [
    'ALREADY_RECORDING',
    'ONGOING_CALL',
    'FILE_CREATION_FAILED',
    'INVALID_SETTINGS',
    'INVALID_CONFIG',
    'PERMISSION_DENIED',
    'NOTIFICATION_PERMISSION_DENIED',
    'AUDIO_FOCUS_ERROR',
    'INITIALIZATION_FAILED',
    'BUFFER_SIZE_ERROR',
    'COMPRESSED_INIT_FAILED',
    'COMPRESSED_START_FAILED',
    'START_FAILED',
    'UNEXPECTED_ERROR',
] as const

export type StartRecordingErrorCode =
    (typeof START_RECORDING_ERROR_CODES)[number]

/**
 * Codes worth retrying once the blocking condition clears.
 *
 * Permission denials are included because retrying is meaningful after the user grants
 * access; the caller decides when that is.
 */
export const RECOVERABLE_START_RECORDING_ERROR_CODES = [
    'ONGOING_CALL',
    'ALREADY_RECORDING',
    'AUDIO_FOCUS_ERROR',
    'PERMISSION_DENIED',
    'NOTIFICATION_PERMISSION_DENIED',
] as const satisfies readonly StartRecordingErrorCode[]

const KNOWN_CODES = new Set<string>(START_RECORDING_ERROR_CODES)
const RECOVERABLE = new Set<string>(RECOVERABLE_START_RECORDING_ERROR_CODES)

export const isStartRecordingErrorCode = (
    value: unknown
): value is StartRecordingErrorCode =>
    typeof value === 'string' && KNOWN_CODES.has(value)

export const isRecoverableStartRecordingError = (
    code: StartRecordingErrorCode
): boolean => RECOVERABLE.has(code)

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
