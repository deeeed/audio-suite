// playground/src/component/audio-visualizer/autio-visualizer.types.ts
import type { ConsoleLike, WaveformBar } from '../types/waveform'
import { TextStyle, ViewStyle } from 'react-native'
import { SharedValue } from 'react-native-reanimated'

import { DecibelGaugeTheme } from '../DecibelGauge/DecibelGauge'
import { DecibelMeterTheme } from '../DecibelMeter/DecibelMeter'

export interface DecibelVisualizationConfig {
    type: 'gauge' | 'meter'
    position:
        | 'top'
        | 'bottom'
        | 'left'
        | 'right'
        | 'topLeft'
        | 'topRight'
        | 'bottomLeft'
        | 'bottomRight'
    orientation?: 'horizontal' | 'vertical' // for meter type
    offset?: {
        x?: number
        y?: number
    }
    dimensions?: {
        width?: number
        height?: number
        length?: number // for meter type
    }
    theme?: Partial<DecibelGaugeTheme | DecibelMeterTheme>
}

export interface AudioVisualizerTheme {
    container: ViewStyle
    navigationContainer: ViewStyle
    canvasContainer: ViewStyle
    referenceLine: ViewStyle
    text: TextStyle
    button: ViewStyle
    buttonText: TextStyle
    dottedLineColor: string
    yAxis: {
        tickColor: string
        labelColor: string
    }
    timeRuler: {
        tickColor: string
        labelColor: string
    }
    candle: {
        activeAudioColor?: string
        activeSpeechColor?: string
        offcanvasColor?: string
        selectedColor?: string
    }
    decibelVisualization?: DecibelVisualizationConfig
}

export type AmplitudeScalingMode = 'raw' | 'normalized' | 'humanVoice'

export interface CalculateReferenceLinePositionParams {
    canvasWidth: number
    referenceLinePosition: 'MIDDLE' | 'RIGHT'
}

export interface GetStylesParams {
    canvasWidth: number
    referenceLineX: number
}

export interface SyncTranslateXParams {
    currentTime: number
    durationMs: number
    maxTranslateX: number
    minTranslateX: number
    translateX: SharedValue<number>
}

export interface DrawDottedLineParams {
    canvasWidth: number
    canvasHeight: number
}

export interface CandleData extends WaveformBar {
    visible: boolean
}

export interface AudioVisualizerState {
    ready: boolean
    triggerUpdate: number
    canvasWidth: number
    currentTime?: number
    hasInitialized: boolean
    selectedCandle: CandleData | null
    selectedIndex: number
}

export interface UpdateActivePointsParams {
    x: number
    logger?: ConsoleLike
    context: {
        dataPoints: WaveformBar[]
        activePoints: CandleData[]
        maxDisplayedItems: number
        referenceLineX: number
        mode: 'static' | 'live'
        range: {
            start: number
            end: number
            startVisibleIndex: number
            endVisibleIndex: number
        }
        candleWidth: number
        candleSpace: number
    }
}

export interface UpdateActivePointsResult {
    activePoints: CandleData[]
    range: {
        start: number
        end: number
        startVisibleIndex: number
        endVisibleIndex: number
    }
    lastUpdatedTranslateX: number
}
