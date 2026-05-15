/**
 * Stable typed errors for `streamAudioData`. Callers can switch on `code`.
 */
export type AudioStreamErrorCode =
    | 'ERR_AUDIO_STREAM_UNSUPPORTED_FORMAT'
    | 'ERR_AUDIO_STREAM_INVALID_RANGE'
    | 'ERR_AUDIO_STREAM_DECODE_FAILED'
    | 'ERR_AUDIO_STREAM_CANCELLED'
    | 'ERR_AUDIO_STREAM_PERMISSION_DENIED'
    | 'ERR_AUDIO_STREAM_FILE_NOT_FOUND'
    | 'ERR_AUDIO_STREAM_BACKPRESSURE_TIMEOUT'
    | 'ERR_AUDIO_STREAM_NATIVE_UNAVAILABLE'
    | 'ERR_AUDIO_STREAM_BUSY'
    | 'ERR_AUDIO_STREAM_UNKNOWN'

export interface AudioStreamErrorPayload {
    code: AudioStreamErrorCode
    message: string
    recoverable: boolean
    fileUri?: string
    platform?: string
    nativeCode?: string
    nativeMessage?: string
}

const RECOVERABLE: AudioStreamErrorCode[] = [
    'ERR_AUDIO_STREAM_CANCELLED',
    'ERR_AUDIO_STREAM_BUSY',
    'ERR_AUDIO_STREAM_BACKPRESSURE_TIMEOUT',
    'ERR_AUDIO_STREAM_PERMISSION_DENIED',
]

export class AudioStreamError extends Error {
    readonly code: AudioStreamErrorCode
    readonly recoverable: boolean
    readonly fileUri?: string
    readonly platform?: string
    readonly nativeCode?: string
    readonly nativeMessage?: string

    constructor(payload: AudioStreamErrorPayload) {
        super(payload.message)
        this.name = 'AudioStreamError'
        this.code = payload.code
        this.recoverable = payload.recoverable
        this.fileUri = payload.fileUri
        this.platform = payload.platform
        this.nativeCode = payload.nativeCode
        this.nativeMessage = payload.nativeMessage
    }

    toJSON(): AudioStreamErrorPayload {
        return {
            code: this.code,
            message: this.message,
            recoverable: this.recoverable,
            fileUri: this.fileUri,
            platform: this.platform,
            nativeCode: this.nativeCode,
            nativeMessage: this.nativeMessage,
        }
    }
}

function getNativeMessage(err: unknown): string {
    if (err instanceof Error) return err.message
    if (typeof err === 'string') return err
    try {
        return JSON.stringify(err) ?? String(err)
    } catch {
        return String(err)
    }
}

function getNativeCode(err: unknown): string | undefined {
    if (err && typeof err === 'object' && 'code' in err) {
        const code = (err as { code?: unknown }).code
        if (typeof code === 'string') return code
    }
    return undefined
}

function isUnknownAudioStreamCode(raw: string | undefined): boolean {
    if (!raw) return false
    return (
        raw.toUpperCase().startsWith('ERR_AUDIO_STREAM_') &&
        normalizeCode(raw) === null
    )
}

function normalizeCode(raw: string | undefined): AudioStreamErrorCode | null {
    if (!raw) return null
    const upper = raw.toUpperCase()
    if (upper.startsWith('ERR_AUDIO_STREAM_')) {
        const known: AudioStreamErrorCode[] = [
            'ERR_AUDIO_STREAM_UNSUPPORTED_FORMAT',
            'ERR_AUDIO_STREAM_INVALID_RANGE',
            'ERR_AUDIO_STREAM_DECODE_FAILED',
            'ERR_AUDIO_STREAM_CANCELLED',
            'ERR_AUDIO_STREAM_PERMISSION_DENIED',
            'ERR_AUDIO_STREAM_FILE_NOT_FOUND',
            'ERR_AUDIO_STREAM_BACKPRESSURE_TIMEOUT',
            'ERR_AUDIO_STREAM_NATIVE_UNAVAILABLE',
            'ERR_AUDIO_STREAM_BUSY',
            'ERR_AUDIO_STREAM_UNKNOWN',
        ]
        if ((known as string[]).includes(upper)) {
            return upper as AudioStreamErrorCode
        }
    }
    if (upper.includes('FILE_NOT_FOUND') || upper === 'ENOENT') {
        return 'ERR_AUDIO_STREAM_FILE_NOT_FOUND'
    }
    if (upper.includes('PERMISSION') || upper === 'EACCES') {
        return 'ERR_AUDIO_STREAM_PERMISSION_DENIED'
    }
    if (
        upper.includes('UNSUPPORTED') ||
        upper.includes('NO_SUITABLE_CODEC') ||
        upper.includes('NO SUITABLE CODEC') ||
        upper.includes('NOT SUPPORTED')
    ) {
        return 'ERR_AUDIO_STREAM_UNSUPPORTED_FORMAT'
    }
    if (
        upper.includes('INVALID_RANGE') ||
        upper.includes('OUT_OF_RANGE') ||
        upper.includes('INVALID_TIME')
    ) {
        return 'ERR_AUDIO_STREAM_INVALID_RANGE'
    }
    if (upper.includes('CANCELLED') || upper.includes('CANCELED')) {
        return 'ERR_AUDIO_STREAM_CANCELLED'
    }
    if (upper.includes('BUSY')) {
        return 'ERR_AUDIO_STREAM_BUSY'
    }
    if (upper.includes('BACKPRESSURE')) {
        return 'ERR_AUDIO_STREAM_BACKPRESSURE_TIMEOUT'
    }
    if (
        upper.includes('DECODE') ||
        upper.includes('CODEC') ||
        upper.includes('MALFORMED')
    ) {
        return 'ERR_AUDIO_STREAM_DECODE_FAILED'
    }
    return null
}

export function mapStreamError(
    err: unknown,
    fileUri?: string,
    platform?: string
): AudioStreamError {
    if (err instanceof AudioStreamError) return err

    const nativeMessage = getNativeMessage(err)
    const nativeCode = getNativeCode(err)
    const lower = nativeMessage.toLowerCase()

    if (isUnknownAudioStreamCode(nativeCode)) {
        console.warn(
            `[AudioStreamError] Unknown native audio stream error code: ${nativeCode}`
        )
    }

    let code =
        normalizeCode(nativeCode) ??
        normalizeCode(nativeMessage) ??
        'ERR_AUDIO_STREAM_UNKNOWN'

    if (code === 'ERR_AUDIO_STREAM_UNKNOWN') {
        if (lower.includes('not found') || lower.includes('does not exist')) {
            code = 'ERR_AUDIO_STREAM_FILE_NOT_FOUND'
        } else if (
            lower.includes('unsupported') ||
            lower.includes('no suitable codec')
        ) {
            code = 'ERR_AUDIO_STREAM_UNSUPPORTED_FORMAT'
        } else if (lower.includes('permission') || lower.includes('denied')) {
            code = 'ERR_AUDIO_STREAM_PERMISSION_DENIED'
        } else if (lower.includes('decode') || lower.includes('codec')) {
            code = 'ERR_AUDIO_STREAM_DECODE_FAILED'
        } else if (lower.includes('cancel')) {
            code = 'ERR_AUDIO_STREAM_CANCELLED'
        }
    }

    return new AudioStreamError({
        code,
        message: `Audio stream failed (${code}): ${nativeMessage}`,
        recoverable: RECOVERABLE.includes(code),
        fileUri,
        platform,
        nativeCode,
        nativeMessage,
    })
}
