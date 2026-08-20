import {
    RECOVERABLE_START_RECORDING_ERROR_CODES,
    START_RECORDING_ERROR_CODES,
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

    it('falls back to START_FAILED for an unrecognised code', () => {
        // Platforms that do not yet report a reason, and older native builds, still
        // reject with something — callers should be able to switch exhaustively.
        expect(startRecordingErrorCode({ code: 'NOPE' })).toBe(
            'START_FAILED'
        )
    })

    it('falls back to START_FAILED for a plain Error', () => {
        expect(startRecordingErrorCode(new Error('boom'))).toBe(
            'START_FAILED'
        )
    })

    it('falls back to START_FAILED for null and undefined', () => {
        expect(startRecordingErrorCode(null)).toBe('START_FAILED')
        expect(startRecordingErrorCode(undefined)).toBe(
            'START_FAILED'
        )
    })
})

describe('isStartRecordingErrorCode', () => {
    it('accepts every documented code', () => {
        // Derived from the exported list, so adding a code without covering it here is
        // impossible rather than merely discouraged.
        for (const code of START_RECORDING_ERROR_CODES) {
            expect(isStartRecordingErrorCode(code)).toBe(true)
        }
    })

    it('round-trips every documented code through the narrowing helper', () => {
        for (const code of START_RECORDING_ERROR_CODES) {
            expect(startRecordingErrorCode({ code })).toBe(code)
        }
    })

    it('rejects anything else', () => {
        expect(isStartRecordingErrorCode('NOPE')).toBe(false)
        expect(isStartRecordingErrorCode(42)).toBe(false)
    })
})

describe('isRecoverableStartRecordingError', () => {
    it('marks exactly the documented recoverable codes', () => {
        const recoverable = new Set<string>(RECOVERABLE_START_RECORDING_ERROR_CODES)
        for (const code of START_RECORDING_ERROR_CODES) {
            expect(isRecoverableStartRecordingError(code)).toBe(recoverable.has(code))
        }
    })

    it('does not treat a configuration failure as retryable', () => {
        expect(isRecoverableStartRecordingError('FILE_CREATION_FAILED')).toBe(false)
        expect(isRecoverableStartRecordingError('INVALID_SETTINGS')).toBe(false)
    })
})
