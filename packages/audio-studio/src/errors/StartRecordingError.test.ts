import {
    isRecoverableStartRecordingError,
    isStartRecordingErrorCode,
    startRecordingErrorCode,
} from './StartRecordingError'

describe('startRecordingErrorCode', () => {
    it('narrows a native rejection to its code', () => {
        expect(
            startRecordingErrorCode({
                code: 'ONGOING_CALL',
                message: 'Cannot start recording during an active phone call.',
            })
        ).toBe('ONGOING_CALL')
    })

    it('falls back to UNKNOWN for an unrecognised code', () => {
        // Platforms that do not yet report a reason, and older native builds, still
        // reject with something — callers should be able to switch exhaustively.
        expect(startRecordingErrorCode({ code: 'NOPE' })).toBe(
            'START_FAILED'
        )
    })

    it('falls back to UNKNOWN for a plain Error', () => {
        expect(startRecordingErrorCode(new Error('boom'))).toBe(
            'START_FAILED'
        )
    })

    it('falls back to UNKNOWN for null and undefined', () => {
        expect(startRecordingErrorCode(null)).toBe('START_FAILED')
        expect(startRecordingErrorCode(undefined)).toBe(
            'START_FAILED'
        )
    })
})

describe('isStartRecordingErrorCode', () => {
    it('accepts every documented code', () => {
        for (const code of [
            'FILE_CREATION_FAILED',
            'AUDIO_FOCUS_ERROR',
            'ONGOING_CALL',
            'ALREADY_RECORDING',
            'COMPRESSED_INIT_FAILED',
            'COMPRESSED_START_FAILED',
            'START_FAILED',
        ]) {
            expect(isStartRecordingErrorCode(code)).toBe(true)
        }
    })

    it('rejects anything else', () => {
        expect(isStartRecordingErrorCode('NOPE')).toBe(false)
        expect(isStartRecordingErrorCode(42)).toBe(false)
    })
})

describe('isRecoverableStartRecordingError', () => {
    it('treats a phone call and an in-progress recording as retryable', () => {
        expect(
            isRecoverableStartRecordingError('ONGOING_CALL')
        ).toBe(true)
        expect(
            isRecoverableStartRecordingError('ALREADY_RECORDING')
        ).toBe(true)
    })

    it('does not treat a configuration failure as retryable', () => {
        expect(
            isRecoverableStartRecordingError('FILE_CREATION_FAILED')
        ).toBe(false)
    })
})
