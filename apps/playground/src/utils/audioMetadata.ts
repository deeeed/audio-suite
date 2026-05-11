export async function getWebAudioDurationMs(fileUri: string): Promise<number | undefined> {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') {
        return undefined
    }

    return new Promise((resolve) => {
        const audio = new Audio()
        let settled = false

        const settle = (durationMs?: number) => {
            if (settled) return
            settled = true
            audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
            audio.removeEventListener('error', handleError)
            audio.removeAttribute('src')
            audio.load()
            resolve(durationMs)
        }

        const handleLoadedMetadata = () => {
            const durationMs = Math.round(audio.duration * 1000)
            settle(Number.isFinite(durationMs) && durationMs > 0 ? durationMs : undefined)
        }

        const handleError = () => settle(undefined)

        audio.preload = 'metadata'
        audio.addEventListener('loadedmetadata', handleLoadedMetadata)
        audio.addEventListener('error', handleError)
        audio.src = fileUri
        audio.load()

        window.setTimeout(() => settle(undefined), 5000)
    })
}
