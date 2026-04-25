import type { AudioFeaturesWasmModule } from './audio-features-wasm'
import { getMelSpectrogramWasmUrl, _registerModuleReset } from './wasmConfig'

// Global factory name for the shared WASM binary. Despite the name referring to
// mel spectrogram, this single binary also exports all audio-features functions.
const WASM_GLOBAL_NAME = 'createMelSpectrogramModule'
let modulePromise: Promise<AudioFeaturesWasmModule> | null = null

_registerModuleReset(() => {
    modulePromise = null
})

function loadScriptTag(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = url
        script.onload = () => resolve()
        script.onerror = () =>
            reject(new Error(`Failed to load script: ${url}`))
        document.head.appendChild(script)
    })
}

export function getWasmModule(): Promise<AudioFeaturesWasmModule> {
    if (!modulePromise) {
        modulePromise = (async () => {
            const url = getMelSpectrogramWasmUrl()
            // Try ESM import first; fall back to <script> tag for UMD modules
            const mod = await import(
                /* webpackIgnore: true */ /* @vite-ignore */ url
            )
            let factory: unknown = mod.default ?? mod
            if (typeof factory !== 'function') {
                // UMD fallback: load via <script> tag so the top-level `var` becomes a global and
                // document.currentScript.src is set (Emscripten uses it to locate the .wasm binary).
                await loadScriptTag(url)
                factory = (globalThis as Record<string, unknown>)[
                    WASM_GLOBAL_NAME
                ]
            }
            if (typeof factory !== 'function') {
                throw new TypeError(
                    `WASM factory '${WASM_GLOBAL_NAME}' not found after loading ${url}`
                )
            }
            return (factory as () => Promise<AudioFeaturesWasmModule>)()
        })().catch((err) => {
            modulePromise = null
            throw err
        })
    }
    return modulePromise
}
