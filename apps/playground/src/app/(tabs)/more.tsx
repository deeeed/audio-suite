import React, { memo, useCallback, useMemo, useState, useRef } from 'react'

import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Image, Linking, Pressable, StyleSheet, View } from 'react-native'
import { Text } from 'react-native-paper'
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type {
    AppTheme } from '@siteed/design-system'
import {
    LabelSwitch,
    ListItem,
    ScreenWrapper,
    useThemePreferences,
} from '@siteed/design-system'

import { TranscriberConfig } from '../../component/TranscriberConfig'
import { Updater } from '../../component/Updater'
import { useAppUpdates } from '../../hooks/useAppUpdates'
import { isWeb } from '../../utils/utils'

import type { LayoutChangeEvent } from 'react-native'

// Background update registration is now handled by useAppUpdates

const getStyles = ({ theme, insets }: { theme: AppTheme, insets?: { bottom: number, top: number } }) => {
    return StyleSheet.create({
        container: {
            gap: theme.spacing.gap || 10,
            paddingHorizontal: theme.padding.s,
            paddingBottom: insets?.bottom || 80,
            paddingTop: 0,
        },
        iconContainer: {
            alignItems: 'center',
        },
        link: {
            padding: 10,
        },
        text: {
            color: theme.colors.text,
        },
        version: {
            fontSize: 12,
            paddingTop: 5,
            color: 'lightgrey',
        },
        versionContainer: {
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 10,
        },
        configSection: {
            marginTop: 16,
            marginBottom: 8,
            backgroundColor: theme.colors.surface,
            borderRadius: 12,
            padding: 16,
        },
        sectionTitle: {
            fontSize: 16,
            fontWeight: '500',
            marginBottom: 8,
            color: theme.colors.onSurface,
        },
        listItemContainer: {
            backgroundColor: theme.colors.surface,
            margin: 0,
        },
        contentMeasure: {
            position: 'absolute',
            opacity: 0,
            zIndex: -1,
            pointerEvents: 'none',
        },
    })
}

/* eslint-disable-next-line @typescript-eslint/no-var-requires, global-require */
const logoSource = require('@assets/icon.png')

const AppInfoBanner = memo(function AppInfoBanner({
    theme,
}: {
    theme: AppTheme
}) {
    const [isExpanded, setIsExpanded] = useState(false)
    const animatedHeight = useSharedValue(56)
    const [contentHeight, setContentHeight] = useState(200) // Default fallback height
    const contentMeasured = useRef(false)
    const styles = useMemo(() => getStyles({ theme }), [theme])

    const handleContentLayout = useCallback((event: LayoutChangeEvent) => {
        const { height } = event.nativeEvent.layout
        if (height > 0 && (!contentMeasured.current || height !== contentHeight)) {
            setContentHeight(height)
            contentMeasured.current = true
            
            // If already expanded, update the animation height
            if (isExpanded) {
                animatedHeight.value = withTiming(height, { duration: 300 })
            }
        }
    }, [contentHeight, isExpanded, animatedHeight])

    const animatedStyle = useAnimatedStyle(() => ({
        height: animatedHeight.value,
    }))

    const toggleExpanded = useCallback(() => {
        setIsExpanded((prev) => {
            const newIsExpanded = !prev
            animatedHeight.value = withTiming(newIsExpanded ? contentHeight : 56, {
                duration: 300,
            })
            return newIsExpanded
        })
    }, [animatedHeight, contentHeight])

    const renderContent = () => (
        <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <Text style={{ color: theme.colors.onTertiaryContainer }}>
                        About Audio Playground
                    </Text>
                </View>
                <MaterialCommunityIcons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={24}
                    color={theme.colors.onTertiaryContainer}
                />
            </View>

            {(isExpanded || contentMeasured.current === false) && (
                <Text
                    style={{
                        marginTop: 16,
                        color: theme.colors.onTertiaryContainer,
                    }}
                >
                    Real-time audio recording, visualization, and analysis for React Native.
                    Live waveforms, spectrograms, and AI-powered processing — all running on device.
                </Text>
            )}
        </>
    )

    return (
        <Pressable onPress={toggleExpanded}>
            {/* Hidden measurement view */}
            <View 
                style={styles.contentMeasure} 
                onLayout={handleContentLayout}
            >
                <View
                    style={{
                        borderRadius: 12,
                        padding: 16,
                        marginBottom: 16,
                        backgroundColor: theme.colors.tertiaryContainer,
                    }}
                >
                    {renderContent()}
                </View>
            </View>
            
            <Animated.View
                style={[
                    {
                        borderRadius: 12,
                        padding: 16,
                        marginBottom: 16,
                        overflow: 'hidden',
                        backgroundColor: theme.colors.tertiaryContainer,
                    },
                    animatedStyle,
                ]}
            >
                {renderContent()}
            </Animated.View>
        </Pressable>
    )
})

export const MoreScreen = () => {
    const router = useRouter()
    const { toggleDarkMode, darkMode, theme } = useThemePreferences()
    const { bottom, top } = useSafeAreaInsets()
    const styles = useMemo(() => getStyles({ theme, insets: { bottom, top } }), [theme, bottom, top])
    const {
        checking,
        downloading,
        doUpdate,
        isUpdateAvailable,
        checkUpdates,
        canUpdate,
        runtimeVersion: runtimeVersionRaw,
        appVersion,
        lastChecked,
        updateDetails,
    } = useAppUpdates()

    // Convert complex runtimeVersion to string if needed
    const runtimeVersion = typeof runtimeVersionRaw === 'string' 
        ? runtimeVersionRaw 
        : 'Unknown'

    return (
        <ScreenWrapper
            withScrollView
            useInsets={false}
            contentContainerStyle={styles.container}
            testID="more-scroll"
        >
            <View style={styles.iconContainer}>
                <Image
                    source={logoSource}
                    style={{ width: 100, height: 100 }}
                />
                <Text>Audio PlayGround</Text>
                <View style={styles.versionContainer}>
                    <Text style={styles.version}>v{appVersion}</Text>
                    <Text style={styles.version}>Runtime: {runtimeVersion}</Text>
                </View>
            </View>

            <AppInfoBanner theme={theme} />

            <View style={styles.configSection}>
                <Text style={styles.sectionTitle}>Links</Text>
                <ListItem
                    contentContainerStyle={styles.listItemContainer}
                    label="GitHub Repository"
                    subLabel="Star or fork the project"
                    onPress={() => Linking.openURL('https://github.com/deeeed/audiolab')}
                />
                <ListItem
                    contentContainerStyle={styles.listItemContainer}
                    label="Siteed.net"
                    subLabel="More projects by Arthur Breton"
                    onPress={() => Linking.openURL('https://siteed.net')}
                />
            </View>

            <LabelSwitch
                label="Dark Mode"
                containerStyle={{
                    backgroundColor: theme.colors.surface,
                }}
                onValueChange={toggleDarkMode}
                value={darkMode}
            />

            {!isWeb && (
                <Updater
                    isUpdateAvailable={isUpdateAvailable}
                    checking={checking}
                    downloading={downloading}
                    onUpdate={doUpdate}
                    onCheck={() => checkUpdates(false)}
                    canUpdate={canUpdate}
                    lastChecked={lastChecked}
                    updateDetails={updateDetails}
                />
            )}

            <View style={styles.configSection}>
                <Text style={styles.sectionTitle}>Transcription Model</Text>
                <TranscriberConfig
                    compact
                    onConfigChange={() => {
                        // Optional callback when config changes
                    }}
                />
            </View>

            {isWeb && (
                <>
                    {__DEV__ && (
                        <ListItem
                            contentContainerStyle={{
                                ...styles.listItemContainer,
                                backgroundColor: theme.colors.primaryContainer,
                            }}
                        label="Web Audio Test"
                        subLabel="Debug web audio chunks duplication"
                            onPress={() => {
                                router.navigate('/web-audio-test')
                            }}
                        />
                    )}
                    <ListItem
                        contentContainerStyle={{
                            ...styles.listItemContainer,
                            backgroundColor: theme.colors.primaryContainer,
                        }}
                        label="Download Apps"
                        subLabel="Get AudioPlayground for iOS and Android"
                        onPress={() => {
                            router.navigate('/download')
                        }}
                    />
                </>
            )}
            <ListItem
                                contentContainerStyle={{
                                    ...styles.listItemContainer,
                                    backgroundColor: theme.colors.primaryContainer,
                                }}
                                label="Audio Device Test"
                                subLabel="Test web audio device detection and selection"
                                onPress={() => {
                                    router.navigate('/audio-device-test')
                                }}
            />
            <ListItem
                contentContainerStyle={styles.listItemContainer}
                label="Logs"
                subLabel="Console logs"
                onPress={() => {
                    router.navigate('/logs')
                }}
            />
            <ListItem
                contentContainerStyle={styles.listItemContainer}
                label="Permissions"
                subLabel="Check and request permissions"
                onPress={() => {
                    router.navigate('/permissions')
                }}
            />
            {__DEV__ && (
                <>
                    {isWeb && (
                        <>
                            <ListItem
                                contentContainerStyle={{
                                    ...styles.listItemContainer,
                                    backgroundColor: theme.colors.errorContainer,
                                }}
                                label="Whisper Debug"
                                subLabel="Whisper Debug (Dev Only)"
                                onPress={() => {
                                    router.navigate('/web-whisper-debug')
                                }}
                            />
                        </>
                    )}
                    {!isWeb && (
                        <>
                            <ListItem
                                contentContainerStyle={{
                                    ...styles.listItemContainer,
                                    backgroundColor: theme.colors.errorContainer,
                                }}
                                label="Moonshine Live Demo"
                                subLabel="Small live streaming with medium finalize-on-stop"
                                onPress={() => {
                                    router.navigate('/moonshine-live')
                                }}
                            />
                            <ListItem
                                contentContainerStyle={{
                                    ...styles.listItemContainer,
                                    backgroundColor: theme.colors.errorContainer,
                                }}
                                label="Moonshine Intent Demo"
                                subLabel="Download embedding model and validate command matching"
                                onPress={() => {
                                    router.navigate('/moonshine-intent')
                                }}
                            />
                            <ListItem
                                contentContainerStyle={{
                                    ...styles.listItemContainer,
                                    backgroundColor: theme.colors.errorContainer,
                                }}
                                label="ASR Benchmark"
                                subLabel="Moonshine vs Whisper device benchmark"
                                onPress={() => {
                                    router.navigate('/asr-benchmark')
                                }}
                            />
                            <ListItem
                                contentContainerStyle={{
                                    ...styles.listItemContainer,
                                    backgroundColor: theme.colors.errorContainer,
                                }}
                                label="Baby Cry"
                                subLabel="Baby Cry"
                                onPress={() => {
                                    router.navigate('/baby-cry')
                                }}
                            />
                            <ListItem
                                contentContainerStyle={{
                                    ...styles.listItemContainer,
                                    backgroundColor: theme.colors.errorContainer,
                                }}
                                label="Playground API"
                                subLabel="Playground API"
                                onPress={() => {
                                    router.navigate('/playgroundapi')
                                }}
                            />
                            <ListItem
                                contentContainerStyle={{
                                    ...styles.listItemContainer,
                                    backgroundColor: theme.colors.errorContainer,
                                }}
                                label="Essentia"
                                subLabel="Essentia"
                                onPress={() => {
                                    router.navigate('/essentia')
                                }}
                            />
                        </>
                    )}
                    {isWeb && (
                        <ListItem
                            contentContainerStyle={{
                                ...styles.listItemContainer,
                                backgroundColor: theme.colors.errorContainer,
                            }}
                            label="WASM Demo"
                            subLabel="WebAssembly Hello World Demo"
                            onPress={() => {
                                router.navigate('/wasm-demo')
                            }}
                        />
                    )}
                </>
            )}
            <ListItem
                contentContainerStyle={styles.listItemContainer}
                label="Trim"
                subLabel="Trim audio"
                onPress={() => {
                    router.navigate('/trim')
                }}
            />
            <ListItem
                contentContainerStyle={styles.listItemContainer}
                label="Preview"
                subLabel="Preview audio"
                onPress={() => {
                    router.navigate('/preview')
                }}
            />
            <ListItem
                contentContainerStyle={styles.listItemContainer}
                label="Audio Player"
                subLabel="Test AudioPlayerWidget waveform, VAD mask, and transport variants"
                onPress={() => {
                    router.navigate('/audio-player')
                }}
            />
            <ListItem
                contentContainerStyle={styles.listItemContainer}
                label="Audio UI Widgets"
                subLabel="Gallery for waveform, player, silence, and chat recorder variants"
                onPress={() => {
                    router.navigate('/audio-ui-widgets')
                }}
            />
            <ListItem
                contentContainerStyle={styles.listItemContainer}
                label="Audio Analysis"
                subLabel="Extract spectral, MFCC, and chromagram features"
                onPress={() => {
                    router.navigate('/audio-analysis')
                }}
            />
            <ListItem
                contentContainerStyle={styles.listItemContainer}
                label="Mel Spectrogram"
                subLabel="Mel spectrogram extraction and visualization"
                onPress={() => {
                    router.navigate('/mel-spectrogram')
                }}
            />
            <ListItem
                contentContainerStyle={styles.listItemContainer}
                label="Decibel"
                subLabel="Decibel Viewer"
                onPress={() => {
                    router.navigate('/decibel')
                }}
            />
            {/* <ListItem
                contentContainerStyle={{
                    backgroundColor: theme.colors.surface,
                    margin: 0,
                }}
                label="Infinite Canvas"
                subLabel="Minimal implementation for infinite canvas"
                onPress={() => {
                    router.navigate('/minimal')
                }}
            /> */}
        </ScreenWrapper>
    )
}

export default MoreScreen
