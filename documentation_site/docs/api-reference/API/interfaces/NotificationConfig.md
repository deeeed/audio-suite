[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / NotificationConfig

# Interface: NotificationConfig

Defined in: [src/AudioStudio.types.ts:569](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L569)

## Properties

### android?

> `optional` **android?**: `object`

Defined in: [src/AudioStudio.types.ts:580](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L580)

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

Defined in: [src/AudioStudio.types.ts:577](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L577)

Icon to be displayed in the notification (resource name or URI)

***

### ios?

> `optional` **ios?**: `object`

Defined in: [src/AudioStudio.types.ts:613](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L613)

iOS-specific notification configuration

#### categoryIdentifier?

> `optional` **categoryIdentifier?**: `string`

Identifier for the notification category (used for grouping similar notifications)

***

### text?

> `optional` **text?**: `string`

Defined in: [src/AudioStudio.types.ts:574](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L574)

Main text content of the notification

***

### title?

> `optional` **title?**: `string`

Defined in: [src/AudioStudio.types.ts:571](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L571)

Title of the notification
