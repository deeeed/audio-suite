import { extractAudioData, trimAudio } from '@siteed/audio-studio'

import type { SetAgenticAsyncResult } from './types'

type AudioStudioAgenticContractDeps = {
    loadSampleFileUri: () => Promise<string>
    setLastAsyncResult: SetAgenticAsyncResult
}

/**
 * Audio Studio CDP regression contracts.
 *
 * Keep these as product-facing invariants that require a real running app
 * bridge. Unit/instrumented tests should own pure native behavior; these
 * contracts prove the JS ↔ native bridge shape used by consumer code.
 */
export function createAudioStudioAgenticContracts({
    loadSampleFileUri,
    setLastAsyncResult,
}: AudioStudioAgenticContractDeps) {
    return {
        testAudioStudioAndroidDecodeContract: () => {
            const op = 'audioStudioAndroidDecodeContract'
            setLastAsyncResult({ op, status: 'pending' })
            void (async () => {
                try {
                    const fileUri = await loadSampleFileUri()
                    const target = {
                        // JS numbers reach Kotlin as Double/Number on Android; this
                        // contract catches regressions that cast them as Int only.
                        sampleRate: 16000,
                        channels: 1,
                        bitDepth: 16,
                    } as const
                    const extracted = await extractAudioData({
                        fileUri,
                        startTimeMs: 0,
                        endTimeMs: 1000,
                        includeBase64Data: true,
                        decodingOptions: {
                            targetSampleRate: target.sampleRate,
                            targetChannels: target.channels,
                            targetBitDepth: target.bitDepth,
                        },
                    })

                    const pcmByteLength =
                        extracted.pcmData?.byteLength ?? extracted.pcmData?.length ?? 0
                    const expectedPcmBytes =
                        extracted.samples * target.channels * (target.bitDepth / 8)
                    if (extracted.sampleRate !== target.sampleRate) {
                        throw new Error(
                            `Expected sampleRate ${target.sampleRate}, got ${extracted.sampleRate}`,
                        )
                    }
                    if (extracted.channels !== target.channels) {
                        throw new Error(
                            `Expected channels ${target.channels}, got ${extracted.channels}`,
                        )
                    }
                    if (extracted.bitDepth !== target.bitDepth) {
                        throw new Error(
                            `Expected bitDepth ${target.bitDepth}, got ${extracted.bitDepth}`,
                        )
                    }
                    if (pcmByteLength !== expectedPcmBytes) {
                        throw new Error(
                            `Expected ${expectedPcmBytes} PCM bytes, got ${pcmByteLength}`,
                        )
                    }

                    const trimmed = await trimAudio({
                        fileUri,
                        startTimeMs: 0,
                        endTimeMs: 1000,
                        outputFormat: {
                            format: 'wav',
                            sampleRate: target.sampleRate,
                            channels: target.channels,
                            bitDepth: target.bitDepth,
                            bitrate: 64000,
                        },
                    })

                    if (trimmed.sampleRate !== target.sampleRate) {
                        throw new Error(
                            `Expected trimmed sampleRate ${target.sampleRate}, got ${trimmed.sampleRate}`,
                        )
                    }
                    if (trimmed.channels !== target.channels) {
                        throw new Error(
                            `Expected trimmed channels ${target.channels}, got ${trimmed.channels}`,
                        )
                    }
                    if (trimmed.bitDepth !== target.bitDepth) {
                        throw new Error(
                            `Expected trimmed bitDepth ${target.bitDepth}, got ${trimmed.bitDepth}`,
                        )
                    }

                    setLastAsyncResult({
                        op,
                        status: 'success',
                        result: {
                            extracted: {
                                sampleRate: extracted.sampleRate,
                                channels: extracted.channels,
                                bitDepth: extracted.bitDepth,
                                durationMs: extracted.durationMs,
                                samples: extracted.samples,
                                pcmByteLength,
                                expectedPcmBytes,
                                hasBase64Data: Boolean(extracted.base64Data),
                            },
                            trimmed: {
                                uri: trimmed.uri,
                                sampleRate: trimmed.sampleRate,
                                channels: trimmed.channels,
                                bitDepth: trimmed.bitDepth,
                                durationMs: trimmed.durationMs,
                                size: trimmed.size,
                            },
                        },
                    })
                } catch (e) {
                    setLastAsyncResult({ op, status: 'error', error: String(e) })
                }
            })()
            return { op, status: 'pending' }
        },
    }
}
