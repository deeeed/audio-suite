[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / NotificationConfig

# Interface: NotificationConfig

Defined in: [src/AudioStudio.types.ts:585](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L585)

## Properties

### android?

> `optional` **android?**: `object`

Defined in: [src/AudioStudio.types.ts:596](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L596)

Android-specific notification configuration

#### accentColor?

> `optional` **accentColor?**: `string`

Accent color for the notification (used for the app icon and buttons)

#### actions?

> `optional` **actions?**: [`NotificationAction`](NotificationAction.md)[]

List of actions that can be performed from the notification

#### channelDescription?

> `optional` **channelDescription?**: `string`

User-visible description of the notification channel

#### channelId?

> `optional` **channelId?**: `string`

Unique identifier for the notification channel

#### channelName?

> `optional` **channelName?**: `string`

User-visible name of the notification channel

#### lightColor?

> `optional` **lightColor?**: `string`

Color of the notification LED (if device supports it)

#### notificationId?

> `optional` **notificationId?**: `number`

Unique identifier for this notification

#### priority?

> `optional` **priority?**: `"default"` \| `"min"` \| `"low"` \| `"high"` \| `"max"`

Priority of the notification (affects how it's displayed)

#### showPauseResumeActions?

> `optional` **showPauseResumeActions?**: `boolean`

Whether to show pause/resume actions in the notification (default: true)

#### waveform?

> `optional` **waveform?**: [`WaveformConfig`](WaveformConfig.md)

Configuration for the waveform visualization in the notification

***

### icon?

> `optional` **icon?**: `string`

Defined in: [src/AudioStudio.types.ts:593](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L593)

Icon to be displayed in the notification (resource name or URI)

***

### ios?

> `optional` **ios?**: `object`

Defined in: [src/AudioStudio.types.ts:629](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L629)

iOS-specific notification configuration

#### categoryIdentifier?

> `optional` **categoryIdentifier?**: `string`

Identifier for the notification category (used for grouping similar notifications)

***

### text?

> `optional` **text?**: `string`

Defined in: [src/AudioStudio.types.ts:590](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L590)

Main text content of the notification

***

### title?

> `optional` **title?**: `string`

Defined in: [src/AudioStudio.types.ts:587](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L587)

Title of the notification
