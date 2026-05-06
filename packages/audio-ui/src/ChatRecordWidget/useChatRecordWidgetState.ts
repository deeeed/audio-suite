import type { MaterialIcons } from '@expo/vector-icons'

export type ChatRecordWidgetState =
    | 'idle'
    | 'recording'
    | 'processing'
    | 'ready'
    | 'error'
    | 'disabled'

/**
 * - 'tap' (default): tap to start, tap again to stop. Voice-memo / iMessage.
 * - 'hold': press & hold while speaking, release to stop. WhatsApp / Telegram.
 *   Caller wires `onPressIn` to record-start and `onPressOut` to record-stop.
 */
export type ChatRecordWidgetInteraction = 'tap' | 'hold'

export type ChatRecordWidgetIconName = keyof typeof MaterialIcons.glyphMap

export type ChatRecordWidgetIconMap = Partial<
    Record<ChatRecordWidgetState, ChatRecordWidgetIconName>
>

export interface UseChatRecordWidgetStateProps {
    state: ChatRecordWidgetState
    interaction?: ChatRecordWidgetInteraction
    onRecordPress?: () => void
    onStopPress?: () => void
    onRetryPress?: () => void
    /** Optional disable override. Combined with state-derived disable. */
    disabled?: boolean
    /** Per-state icon overrides. Falls back to the built-in defaults. */
    primaryIcons?: ChatRecordWidgetIconMap
}

export interface UseChatRecordWidgetStateResult {
    /** Whether the primary action should be disabled. */
    isDisabled: boolean
    /** MaterialIcons name for the primary button under the current state. */
    primaryIcon: ChatRecordWidgetIconName
    /** Tap handler — defined only for `interaction='tap'`. */
    onPress: (() => void) | undefined
    /** Hold-to-record start — defined only for `interaction='hold'` while idle. */
    onPressIn: (() => void) | undefined
    /** Hold-to-record stop — defined only for `interaction='hold'` while recording. */
    onPressOut: (() => void) | undefined
    /** Convenience: true when there's no actionable callback (e.g. processing). */
    isInert: boolean
}

const DEFAULT_ICONS: Record<ChatRecordWidgetState, ChatRecordWidgetIconName> = {
    idle: 'mic',
    recording: 'stop',
    processing: 'hourglass-empty',
    ready: 'check',
    error: 'refresh',
    disabled: 'mic-off',
}

function getDefaultIcon(state: ChatRecordWidgetState): ChatRecordWidgetIconName {
    return DEFAULT_ICONS[state]
}

/**
 * Headless state machine for ChatRecordWidget. Wires the right press handler
 * based on tap vs hold mode and surfaces the canonical icon for the current
 * state. Use it when building a custom-shaped chat recorder UI.
 */
export function useChatRecordWidgetState({
    state,
    interaction = 'tap',
    onRecordPress,
    onStopPress,
    onRetryPress,
    disabled = false,
    primaryIcons,
}: UseChatRecordWidgetStateProps): UseChatRecordWidgetStateResult {
    const isDisabled =
        disabled || state === 'disabled' || state === 'processing'

    const tapAction =
        state === 'recording'
            ? onStopPress
            : state === 'error'
              ? onRetryPress
              : onRecordPress

    const onPress = interaction === 'tap' ? tapAction : undefined
    const onPressIn =
        interaction === 'hold' && state !== 'recording'
            ? onRecordPress
            : undefined
    const onPressOut =
        interaction === 'hold' && state === 'recording'
            ? onStopPress
            : undefined

    const primaryIcon =
        primaryIcons?.[state] ?? getDefaultIcon(state)

    return {
        isDisabled,
        primaryIcon,
        onPress,
        onPressIn,
        onPressOut,
        isInert: !onPress && !onPressIn && !onPressOut,
    }
}
