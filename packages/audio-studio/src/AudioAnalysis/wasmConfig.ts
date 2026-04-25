// Version is inlined here — keep in sync with package.json when releasing.
// The publish.sh script should bump this string alongside package.json.
const WASM_VERSION = '3.0.2'
// jsDelivr syncs from npm automatically within ~5 min of publish.
// GitHub release fallback (attach mel-spectrogram.js as a release asset):
//   https://github.com/deeeed/audiolab/releases/download/@siteed/audio-studio@VERSION/mel-spectrogram.js
// To use the fallback: setMelSpectrogramWasmUrl('<url>') before any mel-spectrogram API call.
const DEFAULT_WASM_CDN = `https://cdn.jsdelivr.net/npm/@siteed/audio-studio@${WASM_VERSION}/prebuilt/wasm/mel-spectrogram.js`

let _wasmUrl: string = DEFAULT_WASM_CDN
const _resetListeners: (() => void)[] = []

export function _registerModuleReset(fn: () => void): void {
    _resetListeners.push(fn)
}

export function setMelSpectrogramWasmUrl(url: string): void {
    _wasmUrl = url
    _resetListeners.forEach((fn) => fn())
}

export function getMelSpectrogramWasmUrl(): string {
    return _wasmUrl
}
