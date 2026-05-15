import { AudioStreamError, mapStreamError } from './AudioStreamError'

describe('AudioStreamError', () => {
    it('passes through an existing AudioStreamError unchanged', () => {
        const original = new AudioStreamError({
            code: 'ERR_AUDIO_STREAM_CANCELLED',
            message: 'aborted',
            recoverable: true,
        })
        expect(mapStreamError(original)).toBe(original)
    })

    it('maps native FILE_NOT_FOUND code', () => {
        const mapped = mapStreamError({
            code: 'FILE_NOT_FOUND',
            message: 'gone',
        })
        expect(mapped.code).toBe('ERR_AUDIO_STREAM_FILE_NOT_FOUND')
        expect(mapped.recoverable).toBe(false)
    })

    it('maps unsupported codec text', () => {
        const mapped = mapStreamError(
            new Error('No suitable codec for audio/opus')
        )
        expect(mapped.code).toBe('ERR_AUDIO_STREAM_UNSUPPORTED_FORMAT')
    })

    it('marks cancellation as recoverable', () => {
        const mapped = mapStreamError({
            code: 'ERR_AUDIO_STREAM_CANCELLED',
            message: 'user cancelled',
        })
        expect(mapped.code).toBe('ERR_AUDIO_STREAM_CANCELLED')
        expect(mapped.recoverable).toBe(true)
    })

    it('maps backpressure timeout as recoverable', () => {
        const mapped = mapStreamError({
            code: 'ERR_AUDIO_STREAM_BACKPRESSURE_TIMEOUT',
            message: 'ack timed out',
        })
        expect(mapped.code).toBe('ERR_AUDIO_STREAM_BACKPRESSURE_TIMEOUT')
        expect(mapped.recoverable).toBe(true)
    })

    it('falls back to UNKNOWN', () => {
        const mapped = mapStreamError({})
        expect(mapped.code).toBe('ERR_AUDIO_STREAM_UNKNOWN')
    })

    it('warns when native returns an unknown audio stream code', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        const mapped = mapStreamError({
            code: 'ERR_AUDIO_STREAM_FOOBAR',
            message: 'new native code',
        })
        expect(mapped.code).toBe('ERR_AUDIO_STREAM_UNKNOWN')
        expect(warn).toHaveBeenCalledWith(
            '[AudioStreamError] Unknown native audio stream error code: ERR_AUDIO_STREAM_FOOBAR'
        )
        warn.mockRestore()
    })

    it('preserves nativeCode and nativeMessage', () => {
        const mapped = mapStreamError({
            code: 'WEIRD_NATIVE_CODE',
            message: 'something went wrong on the bridge',
        })
        expect(mapped.nativeCode).toBe('WEIRD_NATIVE_CODE')
        expect(mapped.nativeMessage).toContain('bridge')
    })

    it('serialises to a stable JSON payload', () => {
        const err = new AudioStreamError({
            code: 'ERR_AUDIO_STREAM_DECODE_FAILED',
            message: 'decoder bust',
            recoverable: false,
            fileUri: 'file:///a.m4a',
            platform: 'ios',
        })
        expect(err.toJSON()).toEqual({
            code: 'ERR_AUDIO_STREAM_DECODE_FAILED',
            message: 'decoder bust',
            recoverable: false,
            fileUri: 'file:///a.m4a',
            platform: 'ios',
            nativeCode: undefined,
            nativeMessage: undefined,
        })
    })
})
