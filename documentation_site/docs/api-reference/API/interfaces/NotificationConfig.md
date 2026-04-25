[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / NotificationConfig

# Interface: NotificationConfig

Defined in: [src/AudioStudio.types.ts:514](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L514)

## Properties

### android?

> `optional` **android**: `object`

Defined in: [src/AudioStudio.types.ts:525](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L525)

Android-specific notification configuration

#### accentColor?

> `optional` **accentColor**: `string`

Accent color for the notification (used for the app icon and buttons)

#### actions?

> `optional` **actions**: [`NotificationAction`](NotificationAction.md)[]

List of actions that can be performed from the notification

#### channelDescription?

> `optional` **channelDescription**: `string`

User-visible description of the notification channel

#### channelId?

> `optional` **channelId**: `string`

Unique identifier for the notification channel

#### channelName?

> `optional` **channelName**: `string`

User-visible name of the notification channel

#### lightColor?

> `optional` **lightColor**: `string`

Color of the notification LED (if device supports it)

#### notificationId?

> `optional` **notificationId**: `number`

Unique identifier for this notification

#### priority?

> `optional` **priority**: `"default"` \| `"min"` \| `"low"` \| `"high"` \| `"max"`

Priority of the notification (affects how it's displayed)

#### showPauseResumeActions?

> `optional` **showPauseResumeActions**: `boolean`

Whether to show pause/resume actions in the notification (default: true)

#### waveform?

> `optional` **waveform**: [`WaveformConfig`](WaveformConfig.md)

Configuration for the waveform visualization in the notification

***

### icon?

> `optional` **icon**: `string`

Defined in: [src/AudioStudio.types.ts:522](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L522)

Icon to be displayed in the notification (resource name or URI)

***

### ios?

> `optional` **ios**: `object`

Defined in: [src/AudioStudio.types.ts:558](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L558)

iOS-specific notification configuration

#### categoryIdentifier?

> `optional` **categoryIdentifier**: `string`

Identifier for the notification category (used for grouping similar notifications)

***

### text?

> `optional` **text**: `string`

Defined in: [src/AudioStudio.types.ts:519](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L519)

Main text content of the notification

***

### title?

> `optional` **title**: `string`

Defined in: [src/AudioStudio.types.ts:516](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L516)

Title of the notification
