 /**
 * @siteed/expo-audio-stream
 * 
 * DEPRECATED: This package has been renamed to @siteed/audio-studio
 * This file serves as a compatibility wrapper that re-exports everything from the new package.
 * 
 * Please update your imports to use @siteed/audio-studio directly.
 */

import * as AudioStudio from '@siteed/audio-studio';

// Display deprecation warning
console.warn(
  '@siteed/expo-audio-stream is deprecated and will be removed in a future version. ' +
  'Please migrate to @siteed/audio-studio, which provides the same functionality with additional features.'
);

// Re-export everything from the new package
export * from '@siteed/audio-studio';

// For backward compatibility with default imports
export default AudioStudio;
