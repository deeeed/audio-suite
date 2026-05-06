import { useMemo, useRef } from 'react'

import type { WaveformAnalysis, WaveformBar } from '../types/waveform'

export interface LiveMelSpectrogramData {
    spectrogram: number[][]
    nMels: number
    timeSteps: number
}

function getPointId(point: WaveformBar | undefined): number {
    return point?.id ?? -1
}

export function useLiveMelSpectrogram(
    analysisData: WaveformAnalysis | undefined,
    maxFrames: number = 50
): LiveMelSpectrogramData | null {
    const lastProcessedIdRef = useRef(-1)
    const framesRef = useRef<number[][]>([])

    return useMemo(() => {
        if (!analysisData?.dataPoints?.length) {
            lastProcessedIdRef.current = -1
            framesRef.current = []
            return null
        }

        const dataPoints = analysisData.dataPoints
        const lastDpId = getPointId(dataPoints.at(-1))

        // Detect reset (new recording): ids jumped backwards
        if (lastDpId < lastProcessedIdRef.current) {
            framesRef.current = []
            lastProcessedIdRef.current = -1
        }

        if (lastDpId === lastProcessedIdRef.current) {
            // No new data
            if (framesRef.current.length === 0) return null
            return {
                spectrogram: framesRef.current,
                nMels: framesRef.current[0]!.length,
                timeSteps: framesRef.current.length,
            }
        }

        // Extract mel frames from datapoints newer than our last checkpoint
        for (const dp of dataPoints) {
            const dpId = getPointId(dp)
            if (dpId <= lastProcessedIdRef.current) continue
            const mel = dp?.features?.melSpectrogram
            if (mel && mel.length > 0) {
                framesRef.current.push(mel)
            }
        }
        lastProcessedIdRef.current = lastDpId

        // Trim to sliding window
        if (framesRef.current.length > maxFrames) {
            framesRef.current = framesRef.current.slice(
                framesRef.current.length - maxFrames
            )
        }

        if (framesRef.current.length === 0) {
            return null
        }

        // Return a new array copy so downstream React detects the change
        const snapshot = [...framesRef.current]
        const nMels = snapshot[0]!.length

        return {
            spectrogram: snapshot,
            nMels,
            timeSteps: snapshot.length,
        }
    }, [analysisData, maxFrames])
}
