// packages/audio-ui/src/AudioVisualizer/CanvasContainer.tsx
import { Canvas, Group, Path, SkFont } from '@shopify/react-native-skia'
import type { WaveformBar } from '../types/waveform'
import React, { useEffect, useMemo, useRef } from 'react'
import { View } from 'react-native'
import { SharedValue, useDerivedValue } from 'react-native-reanimated'

import AnimatedCandle from '../AnimatedCandle/AnimatedCandle'
import { DecibelGauge, DecibelGaugeTheme } from '../DecibelGauge/DecibelGauge'
import { DecibelMeter, DecibelMeterTheme } from '../DecibelMeter/DecibelMeter'
import { SkiaTimeRuler } from '../SkiaTimeRuler/SkiaTimeRuler'
import { Waveform } from '../Waveform/Waveform'
import { YAxis } from '../YAxis/YAxis'
import { defaultCandleColors } from '../constants'
import {
    AmplitudeScalingMode,
    AudioVisualizerTheme,
    CandleData,
} from './AudioVisualiser.types'
import { drawDottedLine } from './AudioVisualizers.helpers'

export interface CanvasContainerProps {
    canvasHeight: number
    candleWidth: number
    candleSpace: number
    showDottedLine: boolean
    showRuler: boolean
    showSilence: boolean
    showYAxis: boolean
    mode: 'static' | 'live' | 'scaled'
    translateX: SharedValue<number>
    activePoints: CandleData[]
    maxDisplayedItems: number
    paddingLeft: number
    totalCandleWidth: number
    startIndex: number
    canvasWidth: number
    selectedCandle: WaveformBar | null
    durationMs?: number
    minAmplitude: number
    maxAmplitude: number
    onSelection: (dataPoint: WaveformBar) => void
    theme: AudioVisualizerTheme
    font?: SkFont
    scaleToHumanVoice: boolean
    disableTapSelection?: boolean
    visualizationType?: 'candles' | 'waveform'
    showSelectedCandle?: boolean
    amplitudeScaling: AmplitudeScalingMode
    currentAmplitude?: number // Current amplitude value for decibel visualization
    testID?: string
}

const CanvasContainer: React.FC<CanvasContainerProps> = ({
    canvasHeight,
    candleWidth,
    candleSpace,
    showDottedLine,
    showYAxis,
    showRuler,
    mode,
    translateX,
    activePoints,
    maxDisplayedItems,
    paddingLeft,
    totalCandleWidth,
    startIndex,
    canvasWidth,
    selectedCandle,
    showSilence,
    durationMs,
    font,
    theme,
    minAmplitude,
    maxAmplitude,
    scaleToHumanVoice,
    visualizationType = 'candles', // default to 'candles' for backward compatibility
    showSelectedCandle = true,
    amplitudeScaling,
    currentAmplitude,
    testID,
}) => {
    const candleColors = {
        ...defaultCandleColors,
        ...theme.candle,
    }

    const groupTransform = useDerivedValue(() => {
        'worklet'
        try {
            // Add null check for translateX
            if (translateX && typeof translateX.value === 'number') {
                return [{ translateX: translateX.value }]
            }
            return [{ translateX: 0 }]
        } catch (error) {
            console.error('Error in groupTransform derived value:', error)
            return [{ translateX: 0 }]
        }
    })

    // Use refs to store the scaling factors
    const scalingFactorRef = useRef<number>(1)
    const humanVoiceScalingFactorRef = useRef<number>(1)

    // Define reference values for human voice range
    const humanVoiceMin = 0.01 // Adjust based on your typical minimum amplitude for speech
    const humanVoiceMax = 0.2 // Maximum amplitude for normal speech
    const absoluteMax = 0.8 // Maximum possible amplitude

    // Define the proportion of canvas height for normal speech
    const normalSpeechHeightProportion = 0.95 // 95% of canvas height for normal speech

    // Update scaling factors when maxAmplitude changes
    useEffect(() => {
        scalingFactorRef.current = canvasHeight / maxAmplitude
        humanVoiceScalingFactorRef.current =
            canvasHeight / (humanVoiceMax - humanVoiceMin)
    }, [maxAmplitude, canvasHeight])

    // Add debug logging for amplitude ranges
    useEffect(() => {
        console.log('Audio Data Range:', {
            minAmplitude,
            maxAmplitude,
            samplePoint: activePoints[0]?.amplitude,
        })
    }, [minAmplitude, maxAmplitude])

    const memoizedCandles = useMemo(() => {
        return activePoints.map(({ id, amplitude, visible, silent }, index) => {
            if (id === -1) return null

            const centerY = canvasHeight / 2

            let scaledAmplitude: number
            switch (amplitudeScaling) {
                case 'raw': {
                    // Add debug logging for raw values
                    if (index === 0) {
                        console.log('Raw Amplitude Debug:', {
                            originalAmplitude: amplitude,
                            minAmplitude,
                            maxAmplitude,
                            samplePoint: activePoints[0]?.amplitude,
                        })
                    }

                    // Scale relative to absolute maximum (1.0) instead of current maxAmplitude
                    const normalizedAmplitude = amplitude // already between 0 and 1

                    // Apply non-linear scaling for better visualization
                    scaledAmplitude =
                        Math.pow(normalizedAmplitude, 0.5) * canvasHeight
                    const clampedAmplitude = Math.max(
                        0,
                        Math.min(scaledAmplitude, canvasHeight)
                    )

                    // Add more detailed logging
                    if (index < 5) {
                        console.log(`Candle ${index} scaling:`, {
                            amplitude,
                            normalizedAmplitude,
                            scaledAmplitude,
                            clampedAmplitude,
                            y: centerY - scaledAmplitude / 2,
                        })
                    }
                    break
                }

                case 'humanVoice':
                    // Existing human voice scaling logic
                    if (amplitude <= humanVoiceMax) {
                        scaledAmplitude =
                            ((amplitude - humanVoiceMin) /
                                (humanVoiceMax - humanVoiceMin)) *
                            (canvasHeight * normalSpeechHeightProportion)
                    } else {
                        const baseHeight =
                            canvasHeight * normalSpeechHeightProportion
                        const extraHeight =
                            canvasHeight * (1 - normalSpeechHeightProportion)
                        const logFactor =
                            Math.log(amplitude / humanVoiceMax) /
                            Math.log(absoluteMax / humanVoiceMax)
                        scaledAmplitude = baseHeight + extraHeight * logFactor
                    }
                    break

                case 'normalized':
                default:
                    // Scale based on the actual maxAmplitude in the data
                    scaledAmplitude = (amplitude / maxAmplitude) * canvasHeight
                    break
            }

            let delta =
                Math.ceil(maxDisplayedItems / 2) * (candleWidth + candleSpace)
            if (mode === 'live') {
                delta = 0
            }
            const x =
                (candleWidth + candleSpace) * index +
                startIndex * (candleWidth + candleSpace) +
                delta

            let color = candleColors.activeAudioColor
            if (!visible) {
                color = candleColors.offcanvasColor
            } else if (selectedCandle && selectedCandle.id === id) {
                color = candleColors.selectedColor
            }

            const key = `${id}`

            return (
                <React.Fragment key={key}>
                    {showSelectedCandle &&
                        selectedCandle &&
                        selectedCandle.id === id && (
                            <Path
                                path={`M${x},0 L${x + candleWidth},0 L${x + candleWidth},${canvasHeight} L${x},${canvasHeight} Z`}
                                color="red"
                                style="stroke"
                                strokeWidth={2}
                            />
                        )}
                    {(!silent || showSilence) && (
                        <AnimatedCandle
                            animated
                            x={x}
                            y={centerY - scaledAmplitude / 2}
                            startY={centerY}
                            width={candleWidth}
                            height={scaledAmplitude}
                            color={color}
                        />
                    )}
                </React.Fragment>
            )
        })
    }, [
        activePoints,
        canvasHeight,
        minAmplitude,
        maxAmplitude,
        maxDisplayedItems,
        showSilence,
        candleWidth,
        candleSpace,
        candleColors,
        mode,
        startIndex,
        selectedCandle,
        scaleToHumanVoice,
        showSelectedCandle,
        amplitudeScaling,
    ])

    // Conditionally render visualization based on 'visualizationType' prop
    const visualizationContent = useMemo(() => {
        if (visualizationType === 'waveform') {
            // Prepare data for Waveform component
            return (
                <Waveform
                    activePoints={activePoints}
                    canvasHeight={canvasHeight}
                    canvasWidth={canvasWidth}
                    minAmplitude={minAmplitude}
                    maxAmplitude={maxAmplitude}
                />
            )
        } else {
            // Default to rendering Candles
            return memoizedCandles
        }
    }, [
        visualizationType,
        activePoints,
        canvasHeight,
        canvasWidth,
        minAmplitude,
        maxAmplitude,
        theme,
        memoizedCandles,
    ])

    // Convert amplitude to decibels (simplified conversion - adjust as needed)
    const amplitudeToDb = (amplitude: number) => {
        if (amplitude <= 0) return -60
        return 20 * Math.log10(amplitude)
    }

    const currentDb = currentAmplitude ? amplitudeToDb(currentAmplitude) : -60

    const renderDecibelVisualization = () => {
        if (!theme.decibelVisualization) return null

        const {
            type,
            position = 'bottomRight',
            orientation = 'horizontal',
            offset = { x: 0, y: 0 },
            dimensions = {},
        } = theme.decibelVisualization

        // Default dimensions
        const gaugeWidth = dimensions.width ?? 200
        const gaugeHeight = dimensions.height ?? 120
        const meterWidth = dimensions.width ?? canvasWidth
        const meterHeight = dimensions.height ?? 60
        const padding = 10

        // Calculate position based on type and position
        let defaultX = 0
        let defaultY = 0

        if (type === 'gauge') {
            // Handle both simple and corner positions
            switch (position) {
                // Corner positions
                case 'bottomRight':
                    defaultX = canvasWidth - gaugeWidth - padding
                    defaultY = canvasHeight - gaugeHeight - padding
                    break
                case 'bottomLeft':
                    defaultX = padding
                    defaultY = canvasHeight - gaugeHeight - padding
                    break
                case 'topRight':
                    defaultX = canvasWidth - gaugeWidth - padding
                    defaultY = padding
                    break
                case 'topLeft':
                    defaultX = padding
                    defaultY = padding
                    break
                // Simple positions
                case 'right':
                    defaultX = canvasWidth - gaugeWidth - padding
                    defaultY = (canvasHeight - gaugeHeight) / 2
                    break
                case 'left':
                    defaultX = padding
                    defaultY = (canvasHeight - gaugeHeight) / 2
                    break
                case 'top':
                    defaultX = (canvasWidth - gaugeWidth) / 2
                    defaultY = padding
                    break
                case 'bottom':
                    defaultX = (canvasWidth - gaugeWidth) / 2
                    defaultY = canvasHeight - gaugeHeight - padding
                    break
            }
        } else {
            // Meter positioning
            switch (position) {
                case 'left':
                case 'right':
                    defaultX =
                        position === 'right'
                            ? canvasWidth - meterWidth - padding
                            : padding
                    defaultY = (canvasHeight - meterHeight) / 2
                    break
                case 'top':
                case 'bottom':
                default:
                    defaultX = (canvasWidth - meterWidth) / 2
                    defaultY =
                        position === 'bottom'
                            ? canvasHeight - meterHeight - padding
                            : padding
                    break
            }
        }

        const transform = [
            { translateX: offset.x ?? defaultX },
            { translateY: offset.y ?? defaultY },
        ]

        if (type === 'gauge') {
            return (
                <Group transform={transform}>
                    <DecibelGauge
                        db={currentDb}
                        theme={{
                            ...theme.decibelVisualization.theme,
                            size: {
                                width: gaugeWidth,
                                height: gaugeHeight,
                            },
                            colors: {
                                needle:
                                    (
                                        theme.decibelVisualization
                                            .theme as Partial<DecibelGaugeTheme>
                                    )?.colors?.needle || '#007AFF',
                                progress:
                                    (
                                        theme.decibelVisualization
                                            .theme as Partial<DecibelGaugeTheme>
                                    )?.colors?.progress || '#FFD60A',
                                high:
                                    (
                                        theme.decibelVisualization
                                            .theme as Partial<DecibelGaugeTheme>
                                    )?.colors?.high || '#FF453A',
                                tickMarks: (
                                    theme.decibelVisualization
                                        .theme as Partial<DecibelGaugeTheme>
                                )?.colors?.tickMarks,
                            },
                        }}
                        font={font}
                    />
                </Group>
            )
        }

        return (
            <Group transform={transform}>
                <DecibelMeter
                    db={currentDb}
                    width={meterWidth}
                    height={meterHeight}
                    length={dimensions.length}
                    theme={{
                        ...theme.decibelVisualization.theme,
                        colors: {
                            low:
                                (
                                    theme.decibelVisualization
                                        .theme as Partial<DecibelMeterTheme>
                                )?.colors?.low || '#34C759',
                            mid:
                                (
                                    theme.decibelVisualization
                                        .theme as Partial<DecibelMeterTheme>
                                )?.colors?.mid || '#FFD60A',
                            high:
                                (
                                    theme.decibelVisualization
                                        .theme as Partial<DecibelMeterTheme>
                                )?.colors?.high || '#FF453A',
                        },
                    }}
                    font={font}
                    orientation={orientation}
                />
            </Group>
        )
    }

    return (
        <View style={theme.canvasContainer}>
            <Canvas
                style={{ height: canvasHeight, width: canvasWidth }}
                testID={testID}
            >
                <Group transform={groupTransform}>
                    {visualizationContent}
                    {showRuler && (
                        <SkiaTimeRuler
                            duration={durationMs ?? 0 / 1000}
                            paddingLeft={paddingLeft}
                            width={totalCandleWidth}
                            font={font}
                            tickColor={theme.timeRuler.tickColor}
                            labelColor={theme.timeRuler.labelColor}
                        />
                    )}
                </Group>
                {showDottedLine && (
                    <>
                        <Path
                            path={drawDottedLine({ canvasWidth, canvasHeight })}
                            color={theme.dottedLineColor || 'grey'}
                            strokeWidth={1}
                            style="stroke"
                        />
                    </>
                )}
                {showYAxis && (
                    <YAxis
                        canvasHeight={canvasHeight}
                        canvasWidth={canvasWidth}
                        minAmplitude={minAmplitude}
                        maxAmplitude={maxAmplitude}
                        font={font}
                        padding={10}
                        tickColor={theme.yAxis.tickColor}
                        labelColor={theme.yAxis.labelColor}
                    />
                )}
                {/* Render decibel visualization within Canvas */}
                {theme.decibelVisualization && (
                    <Group
                        transform={[
                            {
                                translateY:
                                    theme.decibelVisualization.position ===
                                    'top'
                                        ? 0
                                        : canvasHeight -
                                          (theme.decibelVisualization.dimensions
                                              ?.height ?? 60),
                            },
                        ]}
                    >
                        {renderDecibelVisualization()}
                    </Group>
                )}
            </Canvas>
        </View>
    )
}

export default React.memo(CanvasContainer)
