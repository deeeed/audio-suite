import React from 'react'

import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { Text, IconButton } from 'react-native-paper'

import { useTheme } from '@siteed/design-system'

import { useMoonshinePreload } from '../context/MoonshinePreloadProvider'

/**
 * Compact banner showing Moonshine preload progress. Renders nothing once
 * the model is ready so it doesn't take up space during normal usage.
 * Mount it near the top of any screen that benefits from confirming the
 * model is loaded (e.g. chat-record).
 */
export function MoonshinePreloadBanner() {
    const { status, message, error, retry } = useMoonshinePreload()
    const theme = useTheme()
    const colors = theme.colors

    if (status === 'ready' || status === 'idle') return null

    const isError = status === 'error'
    const background = isError ? colors.errorContainer : colors.surfaceVariant
    const foreground = isError ? colors.onErrorContainer : colors.onSurfaceVariant

    return (
        <View
            style={[styles.row, { backgroundColor: background }]}
            testID="moonshine-preload-banner"
        >
            {isError ? null : <ActivityIndicator size="small" color={foreground} />}
            <Text
                style={[styles.text, { color: foreground }]}
                numberOfLines={2}
                testID="moonshine-preload-banner-text"
            >
                {error ?? message ?? 'Preparing Moonshine…'}
            </Text>
            {isError ? (
                <IconButton
                    icon="refresh"
                    size={18}
                    onPress={retry}
                    iconColor={foreground}
                    accessibilityLabel="Retry Moonshine preload"
                    testID="moonshine-preload-banner-retry"
                />
            ) : null}
        </View>
    )
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
    },
    text: {
        flex: 1,
        fontSize: 13,
    },
})
