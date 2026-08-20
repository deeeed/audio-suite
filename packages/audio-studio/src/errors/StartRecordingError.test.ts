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

    // Independent of the derived loops: those iterate the tuple, so deleting a code makes
    // them stop checking it rather than fail. Both of these were genuinely missing from
    // earlier revisions while the derived tests stayed green.
    it('includes the validation codes that were previously omitted', () => {
        expect(isStartRecordingErrorCode('INVALID_SETTINGS')).toBe(true)
        expect(isStartRecordingErrorCode('INVALID_CONFIG')).toBe(true)
        expect(startRecordingErrorCode({ code: 'INVALID_SETTINGS' })).toBe(
            'INVALID_SETTINGS'
        )
        expect(startRecordingErrorCode({ code: 'INVALID_CONFIG' })).toBe('INVALID_CONFIG')
    })

    it('includes the permission and buffer codes that were previously omitted', () => {
        for (const code of [
            'PERMISSION_DENIED',
            'NOTIFICATION_PERMISSION_DENIED',
            'INITIALIZATION_FAILED',
            'BUFFER_SIZE_ERROR',
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
