import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'

/**
 * Resolve an Expo asset to a native file URI that can be passed to native code.
 *
 * Prefer the app cache first so optional native models keep working after Metro
 * disconnects in dev sessions. Only hit expo-asset/Metro when the stable cache
 * entry is missing.
 */
export async function resolveNativeAssetFileUri(
    assetModule: number,
    targetFilename: string,
    errorLabel: string,
): Promise<string> {
    const targetUri = `${FileSystem.cacheDirectory}${targetFilename}`
    const cached = await FileSystem.getInfoAsync(targetUri)
    if (cached.exists && !cached.isDirectory) {
        return targetUri
    }

    const asset = Asset.fromModule(assetModule)
    if (!asset.localUri) {
        await asset.downloadAsync()
    }

    const resolvedUri = asset.localUri ?? asset.uri
    if (!resolvedUri) {
        throw new Error(`${errorLabel} asset did not resolve to a usable URI`)
    }

    if (!resolvedUri.startsWith('file://')) {
        await FileSystem.downloadAsync(resolvedUri, targetUri)
        return targetUri
    }

    if (resolvedUri !== targetUri) {
        await FileSystem.copyAsync({ from: resolvedUri, to: targetUri })
        return targetUri
    }

    return resolvedUri
}
