import React, { useCallback, useMemo, useState, useEffect } from 'react'

import { useFont } from '@shopify/react-native-skia'
import * as DocumentPicker from 'expo-document-picker'
import { StyleSheet, View } from 'react-native'
import { Button, IconButton, Text } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { AppTheme } from '@siteed/design-system'
import { Notice, NumberAdjuster, ScreenWrapper, useTheme, useToast } from '@siteed/design-system'
import type { AudioAnalysis } from '@siteed/audio-studio'
import { extractPreview } from '@siteed/audio-studio'
import { AudioTimeRangeSelector, AudioVisualizer } from '@siteed/audio-ui'

import { baseLogger, config } from '../config'
import { useSampleAudio } from '../hooks/useSampleAudio'
import { isWeb } from '../utils/utils'
import { useScreenHeader } from '../hooks/useScreenHeader'

const SAMPLE_AUDIO = {
    web: `${config.baseUrl}/audio_samples/jfk.mp3`,
}

const logger = baseLogger.extend('PreviewScreen')

interface AudioFile {
    fileUri: string
    mimeType: string
    filename: string
}

interface QuickTimeRange {
    label: string
    startTime: number
    endTime: number
}

const QUICK_TIME_RANGES: QuickTimeRange[] = [
    { label: 'First 10s', startTime: 0, endTime: 10000 },
    { label: '10-60s', startTime: 10000, endTime: 60000 },
]

const getStyles = ({ theme, insets }: { theme: AppTheme, insets?: { bottom: number, top: number } }) => {
    return StyleSheet.create({
        container: {
            gap: theme.spacing.gap || 16,
            paddingHorizontal: theme.padding.s,
            paddingBottom: insets?.bottom || 80,
            paddingTop: 0,
        },
        waveformContainer: {
            borderRadius: 8,
            overflow: 'hidden',
            backgroundColor: theme.colors.surfaceVariant,
        },
        quickRangeContainer: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center',
        },
        quickRangeButton: {
            flex: 1,
            minWidth: 100,
        },
    })
}

export default function PreviewScreen() {
    const theme = useTheme()
    const { bottom, top } = useSafeAreaInsets()
    const styles = useMemo(() => getStyles({ theme, insets: { bottom, top } }), [theme, bottom, top])
    const colors = theme.colors
    const [previewData, setPreviewData] = useState<AudioAnalysis | null>(null)
    const [currentFile, setCurrentFile] = useState<AudioFile | null>(null)
    const [error, setError] = useState<string>()
    const [isProcessing, setIsProcessing] = useState(false)
    const [numberOfPoints, setNumberOfPoints] = useState('100')
    const [startTime, setStartTime] = useState<number>(0)
    const [endTime, setEndTime] = useState<number>(10000)
    const [selectedQuickRange, setSelectedQuickRange] = useState<string | undefined>('First 10s')

    const { show } = useToast()
    const { isLoading: isSampleLoading, loadSampleAudio } = useSampleAudio({
        onError: (error) => {
            logger.error('Error loading sample audio file:', error)
            show({
                type: 'error',
                message: 'Error loading sample audio file',
                duration: 3000,
            })
        },
    })

    useScreenHeader({
        title: 'Audio Preview',
        backBehavior: {
            fallbackUrl: '/more',
        },
    })

    const font = useFont(require('@assets/Roboto/Roboto-Regular.ttf'), 10)
    
    const generatePreview = useCallback(async (fileUri: string) => {
        try {
            setIsProcessing(true)
            if (isWeb && fileUri === SAMPLE_AUDIO.web) {
                setCurrentFile({
                    fileUri,
                    mimeType: 'audio/mp3',
                    filename: 'JFK Speech Sample',
                })
            }
            show({
                loading: true,
                message: 'Generating preview...',
            })

            const effectiveStartTime = startTime || 0
            const effectiveEndTime = endTime || 30000

            const preview = await extractPreview({
                fileUri,
                numberOfPoints: parseInt(numberOfPoints, 10),
                startTimeMs: effectiveStartTime,
                endTimeMs: effectiveEndTime,
            })

            logger.info('Preview generated successfully', {
                durationMs: preview.durationMs,
                dataPoints: preview.dataPoints.length,
                top10: preview.dataPoints.slice(0, 10),
            })

            setPreviewData(preview)
            setError(undefined)

            show({
                type: 'success',
                message: 'Preview generated successfully',
                stackBehavior: {
                    isStackable: false,
                },
                duration: 2000,
            })
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to generate preview')
            show({
                type: 'error',
                message: 'Failed to generate preview',
                duration: 3000,
            })
            console.error('Error generating preview:', err)
        } finally {
            setIsProcessing(false)
        }
    }, [endTime, numberOfPoints, show, startTime])

    const pickAudioFile = useCallback(async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: ['audio/*'],
                copyToCacheDirectory: true,
            })

            if (result.canceled) return

            const newFile = {
                fileUri: result.assets[0].uri,
                mimeType: result.assets[0].mimeType ?? 'audio/*',
                filename: result.assets[0].name ?? 'Unknown',
            }
            
            setCurrentFile(newFile)
            setPreviewData(null)
            setError(undefined)
            
            await generatePreview(newFile.fileUri)
            
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load audio')
            show({
                type: 'error',
                message: 'Failed to load audio file',
                duration: 3000,
            })
        }
    }, [generatePreview, show])

    const handleQuickRangeSelect = useCallback((range: QuickTimeRange) => {
        logger.log('Quick range selected:', range)
        setStartTime(range.startTime)
        setEndTime(range.endTime)
        setSelectedQuickRange(range.label)
        logger.log('After quick range selection - startTime:', range.startTime, 'endTime:', range.endTime, 'selectedQuickRange:', range.label)
    }, [])

    const handleTimeInputChange = useCallback((value: number, setter: (value: number) => void) => {
        logger.log('Time input changed to:', value)
        setter(value)
        setSelectedQuickRange('')
        logger.log('After time input change - selectedQuickRange cleared')
    }, [])

    const handleRangeChange = useCallback((newStartTime: number, newEndTime: number) => {
        logger.log('Range changed - newStartTime:', newStartTime, 'newEndTime:', newEndTime)
        
        setStartTime(newStartTime)
        setEndTime(newEndTime)
        
        // Check if the new range matches any predefined quick range
        // Special case: if the end time is close to the audio duration, it might be clamped
        const audioDuration = previewData?.durationMs || 0
        
        const matchingRange = QUICK_TIME_RANGES.find((range) => {
            // For start time, use exact matching with tolerance
            const startMatches = Math.abs(range.startTime - newStartTime) < 100
            
            // For end time, handle special case when it's clamped to audio duration
            let endMatches = Math.abs(range.endTime - newEndTime) < 100
            
            // If end time is close to audio duration and the range's end time is beyond audio duration,
            // consider it a match (the component likely clamped the value)
            if (audioDuration > 0 && 
                Math.abs(newEndTime - audioDuration) < 100 && 
                range.endTime > audioDuration) {
                endMatches = true
            }
            
            return startMatches && endMatches
        })
        
        logger.log('Matching range found?', matchingRange ? matchingRange.label : 'none', 
                   'audioDuration:', audioDuration, 
                   'endTimeDiff:', audioDuration > 0 ? Math.abs(newEndTime - audioDuration) : 'N/A')
        
        // Only clear the selection if no matching range is found
        if (matchingRange) {
            logger.log('Setting selectedQuickRange to matching range:', matchingRange.label)
            setSelectedQuickRange(matchingRange.label)
        } else {
            logger.log('Clearing selectedQuickRange')
            setSelectedQuickRange('')
        }
    }, [previewData?.durationMs])

    // Add a useEffect to monitor state changes
    useEffect(() => {
        logger.log('State updated - startTime:', startTime, 'endTime:', endTime, 'selectedQuickRange:', selectedQuickRange)
    }, [startTime, endTime, selectedQuickRange])

    const handleLoadSampleAudio = useCallback(async () => {
        try {
            setIsProcessing(true)
            
            // Load the sample audio
            const sampleFile = await loadSampleAudio(require('@assets/jfk.mp3'))
            
            if (!sampleFile) {
                throw new Error('Failed to load sample audio file')
            }
            
            // Update state with the sample file details
            setCurrentFile({
                fileUri: sampleFile.uri,
                mimeType: 'audio/mp3',
                filename: 'JFK Speech Sample',
            })
            
            await generatePreview(sampleFile.uri)
            
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load sample audio')
            show({
                type: 'error',
                message: 'Failed to load sample audio',
                duration: 3000,
            })
        } finally {
            setIsProcessing(false)
        }
    }, [generatePreview, loadSampleAudio, show])

    // Let's also add a log to the AudioTimeRangeSelector to see when it's rendering
    const renderTimeRangeSelector = () => {
        logger.log('Rendering AudioTimeRangeSelector with:', { 
            durationMs: previewData?.durationMs || 0,
            startTime, 
            endTime,
            disabled: isProcessing || !previewData,
        })
        
        return (
            <AudioTimeRangeSelector
                durationMs={previewData?.durationMs || 0}
                startTime={startTime}
                endTime={endTime}
                onRangeChange={handleRangeChange}
                disabled={isProcessing || !previewData}
                theme={{
                    container: {
                        backgroundColor: colors.surfaceVariant,
                        height: 48,
                        borderRadius: 8,
                    },
                    selectedRange: {
                        backgroundColor: colors.primary,
                        opacity: 0.5,
                    },
                    handle: {
                        backgroundColor: colors.primary,
                        width: 20,
                    },
                }}
            />
        )
    }

    // Render quick range buttons based on audio duration
    const renderQuickRangeButtons = () => {
        const audioDuration = previewData?.durationMs || 0
        
        // Filter quick ranges that make sense for this audio file
        const applicableRanges = QUICK_TIME_RANGES.filter((range) => {
            // Only show ranges where at least part of the range is within the audio duration
            return range.startTime < audioDuration
        })
        
        return (
            <View style={styles.quickRangeContainer}>
                {applicableRanges.map((range) => {
                    // For ranges that extend beyond audio duration, modify the label
                    const label = range.endTime > audioDuration 
                        ? `${range.label.split('-')[0]}-End` 
                        : range.label
                    
                    return (
                        <Button
                            key={range.label}
                            mode={selectedQuickRange === range.label ? 'contained' : 'outlined'}
                            onPress={() => handleQuickRangeSelect(range)}
                            disabled={isProcessing}
                        >
                            {label}
                        </Button>
                    )
                })}
                <IconButton
                    mode={selectedQuickRange === 'reset' ? 'contained' : 'outlined'}
                    onPress={() => {
                        setStartTime(0)
                        setEndTime(0)
                        setSelectedQuickRange('reset')
                    }}
                    disabled={isProcessing}
                    icon="refresh"
                />
            </View>
        )
    }

    return (
        <ScreenWrapper 
            withScrollView 
            useInsets={false} 
            contentContainerStyle={styles.container}
        >
            <View style={{ gap: 16 }}>
                <Notice
                    type="info"
                    title="Audio Preview"
                    message="Select an audio file to generate a customized preview of its waveform."
                />

                <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button 
                        mode="contained" 
                        onPress={pickAudioFile}
                        icon="file-upload"
                        loading={isProcessing && !isSampleLoading}
                        disabled={isProcessing}
                        style={{ flex: 1 }}
                    >
                        Select Audio File
                    </Button>

                    <Button 
                        mode="contained-tonal" 
                        onPress={handleLoadSampleAudio}
                        icon="music-box"
                        loading={isSampleLoading}
                        disabled={isProcessing}
                    >
                        Load Sample
                    </Button>
                </View>

                {currentFile && (
                    <View style={{ gap: 16 }}>
                        <View style={{ gap: 8, backgroundColor: colors.secondaryContainer, padding: 16, borderRadius: 8 }}>
                            <Text variant="titleMedium">File Details</Text>
                            <Text>Filename: {currentFile.filename}</Text>
                            <Text>Type: {currentFile.mimeType}</Text>
                        </View>

                        <NumberAdjuster
                            label="Number of Points"
                            value={parseInt(numberOfPoints)}
                            onChange={(value) => setNumberOfPoints(value.toString())}
                            min={10}
                            max={1000}
                            step={10}
                            disabled={isProcessing}
                        />

                        {renderQuickRangeButtons()}

                        {renderTimeRangeSelector()}

                        <NumberAdjuster
                            label="Start Time (ms)"
                            value={startTime}
                            onChange={(value) => handleTimeInputChange(value, setStartTime)}
                            min={0}
                            max={999999}
                            step={100}
                            disabled={isProcessing}
                        />

                        <NumberAdjuster
                            label="End Time (ms)"
                            value={endTime}
                            onChange={(value) => handleTimeInputChange(value, setEndTime)}
                            min={0}
                            max={999999}
                            step={100}
                            disabled={isProcessing}
                        />

                        <Button 
                            mode="contained" 
                            onPress={() => generatePreview(currentFile.fileUri)}
                            icon="waveform"
                            loading={isProcessing}
                            disabled={isProcessing}
                        >
                            Generate Preview
                        </Button>
                    </View>
                )}

                {error && (
                    <Notice
                        type="error"
                        title="Error"
                        message={error}
                    />
                )}

                {previewData && !isProcessing && (
                    <View style={{ gap: 16 }}>
                        <View style={{ gap: 8, backgroundColor: colors.secondaryContainer, padding: 16, borderRadius: 8 }}>
                            <Text variant="titleMedium">Preview Details</Text>
                            <Text>Duration: {(previewData.durationMs / 1000).toFixed(1)}s</Text>
                            <Text>Points: {previewData.dataPoints.length}</Text>
                            <Text>Resolution: {(previewData.segmentDurationMs).toFixed(1)}ms per point</Text>
                            {previewData.amplitudeRange && (
                                <Text>
                                    Amplitude Range: {previewData.amplitudeRange.min.toFixed(3)} to{' '}
                                    {previewData.amplitudeRange.max.toFixed(3)}
                                </Text>
                            )}
                        </View>

                        <AudioVisualizer 
                            audioData={previewData}
                            canvasHeight={200}
                            showRuler
                            enableInertia
                            NavigationControls={() => null}
                            font={font ?? undefined}
                            theme={{
                                container: styles.waveformContainer,
                            }}
                        />
                    </View>
                )}
            </View>
        </ScreenWrapper>
    )
} 
