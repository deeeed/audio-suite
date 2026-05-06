// playground/src/app/_layout.tsx
import { useEffect } from 'react'

import { DefaultTheme, ThemeProvider } from '@react-navigation/native'
import Constants from 'expo-constants'
import { requireNativeModule } from 'expo-modules-core'
import { Platform } from 'react-native'
import { Stack } from 'expo-router/stack'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { SystemBars } from 'react-native-edge-to-edge'

import { useTheme } from '@siteed/design-system'
import { AudioRecorderProvider } from '@siteed/audio-studio'
import { getLogger } from '@siteed/react-native-logger'

import { ApplicationContextProvider } from '../context/ApplicationProvider'
import { AudioFilesProvider } from '../context/AudioFilesProvider'
import { MoonshinePreloadProvider } from '../context/MoonshinePreloadProvider'
import { TranscriptionProvider } from '../context/TranscriptionProvider'
import { WebAppBanner } from '../components/WebAppBanner'
import { AgentStepHud } from '../components/AgentStepHud'
import { AgenticBridgeSync } from '../components/AgenticBridgeSync'

// Install the __AGENTIC__ bridge on globalThis in dev mode
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (__DEV__) require('../agentic-bridge')

// WHY this is needed on Android production only:
// In dev, Metro serves fonts as real file URIs so Font.loadAsync works normally.
// In production Hermes bundles, require('font.ttf') returns a numeric asset registry
// ID — Font.loadAsync routes all sources through expo-asset's downloadAsync, which
// cannot resolve those IDs on Android and fails with an android_res:// URI error.
//
// The expo-font plugin (app.config.ts) already embeds fonts in assets/fonts/ and
// ReactFontManager registers them under their filename (MaterialCommunityIcons, etc.),
// but @expo/vector-icons looks up different family names (material-community, etc.).
// Fix: call ExpoFontLoader.loadAsync directly to register aliases, bypassing expo-asset.
// Triple-slash (asset:///) is required: FontLoaderModule strips 9 chars from the URI,
// so 'asset:///fonts/Name.ttf' → 'fonts/Name.ttf' for Typeface.createFromAsset().

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ExpoFontLoader: any = null
if (Platform.OS === 'android') {
    try {
        ExpoFontLoader = requireNativeModule('ExpoFontLoader')
    } catch {
        // not available
    }
}

const logger = getLogger('RootLayout')

export default function RootLayout() {
    const baseUrl = Constants.expoConfig?.experiments?.baseUrl ?? ''
    const theme = useTheme()

    useEffect(() => {
        if (__DEV__ || Platform.OS !== 'android' || !ExpoFontLoader?.loadAsync) return
        async function loadIconFonts() {
            try {
                await ExpoFontLoader.loadAsync('material-community', 'asset:///fonts/MaterialCommunityIcons.ttf')
                await ExpoFontLoader.loadAsync('ionicons',           'asset:///fonts/Ionicons.ttf')
                await ExpoFontLoader.loadAsync('material',           'asset:///fonts/MaterialIcons.ttf')
                await ExpoFontLoader.loadAsync('FontAwesome',        'asset:///fonts/FontAwesome.ttf')
                await ExpoFontLoader.loadAsync('entypo',             'asset:///fonts/Entypo.ttf')
            } catch (e) {
                logger.warn('Failed to register icon font aliases:', e)
            }
        }
        loadIconFonts()
    }, [])

    useEffect(() => {
        logger.log(`Base URL: ${baseUrl}`)
    }, [baseUrl])

    // Create a merged theme that properly combines DefaultTheme with our custom theme
    const navigationTheme = {
        ...DefaultTheme,
        ...theme,
        colors: {
            ...DefaultTheme.colors,
            ...theme.colors,
        },
        fonts: DefaultTheme.fonts,
    }

    return (
        <SafeAreaProvider>
            <ApplicationContextProvider debugMode>
                <TranscriptionProvider>
                    <AudioRecorderProvider
                        config={{
                            logger: getLogger('AudioRecorderProvider'),
                            // audioWorkletUrl: config.audioWorkletUrl,
                            // featuresExtratorUrl: config.featuresExtratorUrl,
                        }}
                    >
                        <AudioFilesProvider>
                            <MoonshinePreloadProvider>
                            <ThemeProvider value={navigationTheme}>
                                {/* Use SystemBars to manage system bars styling */}
                                <SystemBars style={theme.dark ? 'light' : 'dark'} />

                                {/* WebAppBanner appears above all content on web platform */}
                                <WebAppBanner />
                                <AgenticBridgeSync />
                                <AgentStepHud />

                                <Stack
                                    screenOptions={{
                                        headerBackButtonMenuEnabled: false,
                                        headerStyle: {
                                            backgroundColor: theme.colors.background,
                                        },
                                        headerTintColor: theme.colors.text,
                                        // Configure for proper edge-to-edge display
                                        contentStyle: {
                                            backgroundColor: theme.colors.background,
                                        },
                                    }}
                                >
                                    <Stack.Screen
                                        name="(tabs)"
                                        options={{ headerShown: false }}
                                    />
                                    {/* <Stack.Screen name="playbug" /> */}
                                </Stack>
                            </ThemeProvider>
                            </MoonshinePreloadProvider>
                        </AudioFilesProvider>
                    </AudioRecorderProvider>
                </TranscriptionProvider>
            </ApplicationContextProvider>
        </SafeAreaProvider>
    )
}
