/**
 * Typed error class for audio extraction failures.
 * Wraps native module errors with stable codes consumers can switch on.
 */
export type AudioExtractionErrorCode =
    | 'unsupported_codec'
    | 'malformed_file'
    | 'decode_failed'
    | 'permission_denied'
    | 'file_not_found'
    | 'unknown'

export interface AudioExtractionErrorPayload {
    code: AudioExtractionErrorCode
    message: string
    nativeMessage?: string
    fileUri?: string
}

export class AudioExtractionError extends Error {
    readonly code: AudioExtractionErrorCode
    readonly nativeMessage?: string
    readonly fileUri?: string

    constructor(payload: AudioExtractionErrorPayload) {
        super(payload.message)
        this.name = 'AudioExtractionError'
        this.code = payload.code
        this.nativeMessage = payload.nativeMessage
        this.fileUri = payload.fileUri
    }

    toJSON(): AudioExtractionErrorPayload {
        return {
            code: this.code,
            message: this.message,
            nativeMessage: this.nativeMessage,
            fileUri: this.fileUri,
        }
    }
}

/**
 * Map a thrown native/JS value into an AudioExtractionError with a stable code.
 * Heuristics inspect message text and known native error codes.
 */
export function mapExtractionError(
    err: unknown,
    fileUri?: string,
): AudioExtractionError {
    if (err instanceof AudioExtractionError) return err

    const nativeMessage =
        err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
    const lower = nativeMessage.toLowerCase()

    let code: AudioExtractionErrorCode = 'unknown'
    if (
        lower.includes('unsupported') ||
        lower.includes('not supported') ||
        lower.includes('no suitable codec') ||
        lower.includes('no track')
    ) {
        code = 'unsupported_codec'
    } else if (
        lower.includes('not found') ||
        lower.includes('no such file') ||
        lower.includes('does not exist')
    ) {
        code = 'file_not_found'
    } else if (
        lower.includes('permission') ||
        lower.includes('denied') ||
        lower.includes('not authorized')
    ) {
        code = 'permission_denied'
    } else if (
        lower.includes('malformed') ||
        lower.includes('corrupt') ||
        lower.includes('invalid header') ||
        lower.includes('invalid wav')
    ) {
        code = 'malformed_file'
    } else if (
        lower.includes('decode') ||
        lower.includes('codec') ||
        lower.includes('mediaextractor') ||
        lower.includes('avaudio')
    ) {
        code = 'decode_failed'
    }

    return new AudioExtractionError({
        code,
        message: `Audio extraction failed (${code}): ${nativeMessage}`,
        nativeMessage,
        fileUri,
    })
}
