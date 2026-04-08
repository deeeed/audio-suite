export const MOONSHINE_WEB_TRANSCRIBER_OPTION_NAMES = {
  decoderUrl: 'web_decoder_url',
  encoderUrl: 'web_encoder_url',
  progressModelBasePath: 'web_progress_model_base_path',
} as const;

export type MoonshineWebTranscriberOptionName =
  (typeof MOONSHINE_WEB_TRANSCRIBER_OPTION_NAMES)[keyof typeof MOONSHINE_WEB_TRANSCRIBER_OPTION_NAMES];
