#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import asrEvalManifest from './asr-eval-manifest.mjs'
import { getMetroHost } from './metro-host.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..')
const BRIDGE = path.join(APP_ROOT, 'scripts/agentic/cdp-bridge.mjs')
const REPORT_DIR = path.join(APP_ROOT, '.agent', 'reports')
const MODEL_CACHE_DIR =
    process.env.BENCHMARK_MODEL_CACHE_DIR || path.join(APP_ROOT, '.agent', 'model-cache')
const MOBILE_RECOMMENDATION_MODEL_IDS = Object.freeze([...readMobileRecommendationModelIds()])
const PERPS_ECHOBRIDGE_CLIP_IDS = Object.freeze(['perps-controller-refactor-5m-echobridge-medium'])
const MOBILE_RECOMMENDATION_PERPS_PRESET = Object.freeze({
    clipIds: [...PERPS_ECHOBRIDGE_CLIP_IDS],
    modelIds: [...MOBILE_RECOMMENDATION_MODEL_IDS],
})
const DEVICE = process.env.BENCHMARK_DEVICE || process.env.AGENTIC_DEVICE || ''
const SERIAL = process.env.ANDROID_SERIAL || process.env.ADB_SERIAL || ''
const APP_VARIANT = process.env.APP_VARIANT || 'development'
const BUNDLE_BASE = 'net.siteed.audioplayground'
const SCHEME_BASE = 'audioplayground'
const PKG = APP_VARIANT === 'production' ? BUNDLE_BASE : `${BUNDLE_BASE}.${APP_VARIANT}`
const DEV_CLIENT_SCHEME =
    process.env.DEV_CLIENT_SCHEME ||
    (APP_VARIANT === 'production' ? `exp+${SCHEME_BASE}` : `exp+${SCHEME_BASE}-${APP_VARIANT}`)
const ROUTE = '/asr-benchmark'
const OFFLINE_TIMEOUT_MS = Number(process.env.BENCHMARK_OFFLINE_TIMEOUT_MS || 10 * 60 * 1000)
const SIMULATED_TIMEOUT_MS = Number(process.env.BENCHMARK_SIMULATED_TIMEOUT_MS || 10 * 60 * 1000)
const STATE_TIMEOUT_MS = 90 * 1000
const POLL_INTERVAL_MS = 1000
const SHERPA_SOURCE_PACKAGE =
    process.env.SHERPA_SOURCE_PACKAGE || 'net.siteed.sherpavoice.development'
const SHERPA_MODEL_STAGING = {
    'sherpa-qwen3-asr-0.6b-int8': {
        sourcePackage: SHERPA_SOURCE_PACKAGE,
        relativePath:
            'models/qwen3-asr-0.6B-int8-2026-03-25/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25',
        requiredFiles: [
            'encoder.int8.onnx',
            'decoder.int8.onnx',
            'conv_frontend.onnx',
            'tokenizer',
        ],
    },
    'sherpa-whisper-small': {
        sourcePackage: SHERPA_SOURCE_PACKAGE,
        relativePath: 'models/whisper-small-multilingual/sherpa-onnx-whisper-small',
        archiveUrl:
            'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2',
        archiveFileName: 'sherpa-onnx-whisper-small.tar.bz2',
        requiredFiles: ['small-encoder.onnx', 'small-decoder.onnx', 'small-tokens.txt'],
    },
    'sherpa-whisper-medium': {
        sourcePackage: SHERPA_SOURCE_PACKAGE,
        relativePath: 'models/whisper-medium-multilingual/sherpa-onnx-whisper-medium',
        archiveUrl:
            'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-medium.tar.bz2',
        archiveFileName: 'sherpa-onnx-whisper-medium.tar.bz2',
        requiredFiles: ['medium-encoder.onnx', 'medium-decoder.onnx', 'medium-tokens.txt'],
    },
    'sherpa-whisper-medium-int8': {
        sourcePackage: SHERPA_SOURCE_PACKAGE,
        relativePath: 'models/whisper-medium-multilingual/sherpa-onnx-whisper-medium',
        archiveUrl:
            'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-medium.tar.bz2',
        archiveFileName: 'sherpa-onnx-whisper-medium.tar.bz2',
        requiredFiles: [
            'medium-encoder.int8.onnx',
            'medium-decoder.int8.onnx',
            'medium-tokens.txt',
        ],
    },
}
const MOONSHINE_MODEL_STAGING = {
    'moonshine-small-streaming-en': {
        slug: 'small-streaming-en',
        baseUrl: 'https://download.moonshine.ai/model/small-streaming-en/quantized',
        relativePath: 'moonshine-models/moonshine-small-streaming-en',
        files: {
            'adapter.ort': 2867424,
            'cross_kv.ort': 5298736,
            'decoder_kv.ort': 81435904,
            'decoder_kv_with_attention.ort': 81380336,
            'encoder.ort': 43853224,
            'frontend.ort': 30984200,
            'streaming_config.json': 512,
            'tokenizer.bin': 249974,
        },
    },
    'moonshine-medium-streaming-en': {
        slug: 'medium-streaming-en',
        baseUrl: 'https://download.moonshine.ai/model/medium-streaming-en/quantized',
        relativePath: 'moonshine-models/moonshine-medium-streaming-en',
        files: {
            'adapter.ort': 3647712,
            'cross_kv.ort': 11544952,
            'decoder_kv.ort': 146216448,
            'decoder_kv_with_attention.ort': 146138304,
            'encoder.ort': 94202872,
            'frontend.ort': 47467256,
            'streaming_config.json': 513,
            'tokenizer.bin': 249974,
        },
    },
}
const PRESETS = {
    'moonshine-longform': {
        clipIds: [
            'ami-is1001a-150-170',
            'jfk-public-quote',
            'recorder-jre-lex-watch',
            'osr-us-000-0010-8k',
        ],
        modelIds: ['moonshine-small-streaming-en', 'moonshine-medium-streaming-en'],
    },
    'moonshine-echobridge-perps-5m': {
        clipIds: PERPS_ECHOBRIDGE_CLIP_IDS,
        modelIds: ['moonshine-small-streaming-en', 'moonshine-medium-streaming-en'],
    },
    'sherpa-echobridge-perps-5m': {
        clipIds: PERPS_ECHOBRIDGE_CLIP_IDS,
        modelIds: ['sherpa-qwen3-asr-0.6b-int8'],
    },
    'sherpa-whisper-echobridge-perps-5m': {
        clipIds: PERPS_ECHOBRIDGE_CLIP_IDS,
        modelIds: ['sherpa-whisper-small', 'sherpa-whisper-medium-int8'],
    },
    'sherpa-whisper-fp32-echobridge-perps-5m': {
        clipIds: PERPS_ECHOBRIDGE_CLIP_IDS,
        modelIds: ['sherpa-whisper-medium'],
    },
    'mobile-asr-recommendation-echobridge-perps-5m': MOBILE_RECOMMENDATION_PERPS_PRESET,
    'moonshine-sherpa-echobridge-perps-5m': MOBILE_RECOMMENDATION_PERPS_PRESET,
}

const ALL_MODELS = [
    { id: 'moonshine-small-streaming-en', live: true },
    { id: 'moonshine-medium-streaming-en', live: true },
    { id: 'whisper-small', live: true },
    { id: 'sherpa-qwen3-asr-0.6b-int8', live: true },
    { id: 'sherpa-whisper-small', live: false },
    { id: 'sherpa-whisper-medium-int8', live: false },
    { id: 'sherpa-whisper-medium', live: false },
]
const ALL_MODEL_IDS = new Set(ALL_MODELS.map((model) => model.id))
const unknownMobileRecommendationModelIds = MOBILE_RECOMMENDATION_MODEL_IDS.filter(
    (modelId) => !ALL_MODEL_IDS.has(modelId),
)
if (unknownMobileRecommendationModelIds.length > 0) {
    throw new Error(
        `Unknown mobile recommendation model ids in asrMobileRecommendationModelIds.json: ${unknownMobileRecommendationModelIds.join(', ')}`,
    )
}
// Shared with ASR_MOBILE_RECOMMENDATION_MODEL_IDS in
// apps/playground/src/utils/asrBenchmarkModels.ts via asrMobileRecommendationModelIds.json.
// It intentionally excludes FP32 Whisper Medium and Whisper Small (whisper.rn) unless explicitly requested.
const DEFAULT_MODEL_IDS = new Set(MOBILE_RECOMMENDATION_MODEL_IDS)
const configuredPreset = String(process.env.BENCHMARK_PRESET || '').trim()
const presetConfig = configuredPreset ? PRESETS[configuredPreset] : null
if (configuredPreset && !presetConfig) {
    throw new Error(
        `Unknown BENCHMARK_PRESET=${configuredPreset}. Available presets: ${Object.keys(PRESETS).join(', ')}`,
    )
}
const configuredModelsRaw = String(process.env.BENCHMARK_MODELS || '').trim()
const shouldRunAllModels = configuredModelsRaw.toLowerCase() === 'all'
const configuredModelIds = new Set(
    String(shouldRunAllModels ? '' : configuredModelsRaw || presetConfig?.modelIds?.join(',') || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
)
const configuredClipIds = new Set(
    String(process.env.BENCHMARK_CLIPS || presetConfig?.clipIds?.join(',') || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
)
const OFFLINE_MODELS = shouldRunAllModels
    ? ALL_MODELS
    : configuredModelIds.size > 0
      ? ALL_MODELS.filter((model) => configuredModelIds.has(model.id))
      : ALL_MODELS.filter((model) => DEFAULT_MODEL_IDS.has(model.id))
const SIMULATED_MODELS = OFFLINE_MODELS.filter((model) => model.live)
const EVAL_CLIPS =
    configuredClipIds.size > 0
        ? asrEvalManifest.filter((clip) => configuredClipIds.has(clip.id))
        : asrEvalManifest

fs.mkdirSync(REPORT_DIR, { recursive: true })

function getSimulatedRuntimeFallback(model) {
    if (model.id === 'sherpa-qwen3-asr-0.6b-int8') return 'rolling-offline'
    if (model.id.startsWith('whisper')) return 'rolling-offline'
    return 'streaming'
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function readMobileRecommendationModelIds() {
    const configPath = path.join(APP_ROOT, 'src/utils/asrMobileRecommendationModelIds.json')
    try {
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        if (
            !Array.isArray(parsed) ||
            parsed.length === 0 ||
            !parsed.every((modelId) => typeof modelId === 'string' && modelId.length > 0)
        ) {
            throw new Error('expected a non-empty string array')
        }
        return parsed
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Failed to load ${configPath}: ${message}`)
    }
}

function run(
    command,
    args,
    { cwd = REPO_ROOT, parseJson = false, maxBuffer = 50 * 1024 * 1024 } = {},
) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        env: {
            ...process.env,
            APP_ROOT,
        },
        maxBuffer,
    })

    if (result.status !== 0) {
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
        throw new Error(output || `${command} ${args.join(' ')} failed`)
    }

    const stdout = (result.stdout || '').trim()
    if (!parseJson) return stdout
    return stdout ? JSON.parse(stdout) : null
}

function tryRun(command, args, options = {}) {
    try {
        return run(command, args, options)
    } catch (_error) {
        return null
    }
}

function adb(args) {
    const adbArgs = SERIAL ? ['-s', SERIAL, ...args] : args
    return run('adb', adbArgs, { parseJson: false })
}

function adbShell(command) {
    return adb(['shell', command])
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function readPackageVersion(relativePath) {
    try {
        const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'))
        return packageJson.version ?? null
    } catch (_error) {
        return null
    }
}

function sha256File(filePath) {
    const hash = crypto.createHash('sha256')
    const data = fs.readFileSync(filePath)
    hash.update(data)
    return hash.digest('hex')
}

function getHostFileFingerprint(filePath) {
    try {
        const stat = fs.statSync(filePath)
        return {
            path: filePath,
            sizeBytes: stat.size,
            sha256: sha256File(filePath),
        }
    } catch (error) {
        return {
            path: filePath,
            error: error instanceof Error ? error.message : String(error),
        }
    }
}

function getDeviceFileFingerprint(filePath) {
    try {
        const output = adbShell(
            `run-as ${PKG} sh -c "if test -f ${shellQuote(filePath)}; then wc -c < ${shellQuote(
                filePath,
            )}; sha256sum ${shellQuote(filePath)}; else echo MISSING; fi"`,
        ).trim()
        if (!output || output === 'MISSING') {
            return { path: filePath, exists: false }
        }
        const [sizeLine = '', hashLine = ''] = output.split('\n')
        const hash = hashLine.trim().split(/\s+/)[0] || null
        return {
            path: filePath,
            exists: true,
            sizeBytes: Number(sizeLine.trim()) || null,
            sha256: hash,
        }
    } catch (error) {
        return {
            path: filePath,
            error: error instanceof Error ? error.message : String(error),
        }
    }
}

function requiredFilesTest(basePath, requiredFiles = []) {
    const tests = [`test -d ${shellQuote(basePath)}`]
    for (const fileName of requiredFiles) {
        tests.push(`test -e ${shellQuote(`${basePath}/${fileName}`)}`)
    }
    return tests.join(' && ')
}

function adbCommandPrefix() {
    return SERIAL ? `adb -s ${shellQuote(SERIAL)}` : 'adb'
}

function readAppPssKb() {
    try {
        const output = adb(['shell', 'dumpsys', 'meminfo', PKG])
        const totalLine = output.split('\n').find((line) => line.trim().startsWith('TOTAL '))
        const match = totalLine?.trim().match(/^TOTAL\s+(\d+)/)
        return match?.[1] ? Number(match[1]) : null
    } catch (_error) {
        return null
    }
}

function getDeviceInfo() {
    const getprop = (name) =>
        tryRun('adb', [...(SERIAL ? ['-s', SERIAL] : []), 'shell', 'getprop', name])
    return {
        serial: SERIAL || null,
        requestedDevice: DEVICE || null,
        productModel: getprop('ro.product.model'),
        productManufacturer: getprop('ro.product.manufacturer'),
        androidRelease: getprop('ro.build.version.release'),
        androidSdk: getprop('ro.build.version.sdk'),
        buildFingerprint: getprop('ro.build.fingerprint'),
    }
}

function getGitInfo() {
    return {
        branch: tryRun('git', ['branch', '--show-current']),
        commit: tryRun('git', ['rev-parse', 'HEAD']),
        dirty: Boolean(tryRun('git', ['status', '--porcelain'])),
    }
}

function getModelProvenance(model) {
    const moonshine = MOONSHINE_MODEL_STAGING[model.id]
    if (moonshine) {
        const deviceDir = `/data/user/0/${PKG}/files/${moonshine.relativePath}`
        return {
            modelId: model.id,
            engine: 'moonshine',
            slug: moonshine.slug,
            sourceBaseUrl: moonshine.baseUrl,
            deviceDir,
            files: Object.entries(moonshine.files).map(([fileName, expectedBytes]) => ({
                fileName,
                expectedBytes,
                sourceUrl: `${moonshine.baseUrl}/${fileName}`,
                device: getDeviceFileFingerprint(`${deviceDir}/${fileName}`),
            })),
        }
    }

    const sherpa = SHERPA_MODEL_STAGING[model.id]
    if (sherpa) {
        const deviceDir = `/data/user/0/${PKG}/files/${sherpa.relativePath}`
        return {
            modelId: model.id,
            engine: 'sherpa',
            sourcePackage: sherpa.sourcePackage,
            sourceArchiveUrl: sherpa.archiveUrl ?? null,
            archiveFileName: sherpa.archiveFileName ?? null,
            relativePath: sherpa.relativePath,
            deviceDir,
            files: (sherpa.requiredFiles || []).map((fileName) => ({
                fileName,
                device: getDeviceFileFingerprint(`${deviceDir}/${fileName}`),
            })),
        }
    }

    return {
        modelId: model.id,
        engine: model.id.startsWith('whisper') ? 'whisper.rn' : 'unknown',
        files: [],
        note: 'No device model fingerprint metadata is configured for this model id.',
    }
}

function collectReproducibilityMetadata(generatedAt) {
    return {
        generatedAt,
        script: path.relative(REPO_ROOT, fileURLToPath(import.meta.url)),
        git: getGitInfo(),
        packageVersions: {
            audioPlayground: readPackageVersion('apps/playground/package.json'),
            moonshineRn: readPackageVersion('packages/moonshine.rn/package.json'),
            sherpaOnnxRn: readPackageVersion('packages/sherpa-onnx.rn/package.json'),
        },
        app: {
            packageName: PKG,
            appVariant: APP_VARIANT,
            route: ROUTE,
        },
        device: getDeviceInfo(),
        benchmarkConfig: {
            preset: configuredPreset || null,
            clips: Array.from(configuredClipIds),
            models: Array.from(configuredModelIds),
            resolvedModels: OFFLINE_MODELS.map((model) => model.id),
            runAllModels: shouldRunAllModels,
            offlineTimeoutMs: OFFLINE_TIMEOUT_MS,
            simulatedTimeoutMs: SIMULATED_TIMEOUT_MS,
            modelCacheDir: MODEL_CACHE_DIR,
        },
        selectedModels: OFFLINE_MODELS.map((model) => getModelProvenance(model)),
        evalSet: EVAL_CLIPS.map((clip) => ({
            id: clip.id,
            label: clip.label,
            host: getHostFileFingerprint(resolveHostPath(clip)),
            deviceClip: getDeviceClipPath(clip),
            transcriptSource: clip.transcriptSource,
            hasReferenceTranscript: Boolean(clip.referenceTranscript),
        })),
    }
}

function ensureHostSherpaModel(staging, modelId) {
    const hostModelPath = path.join(MODEL_CACHE_DIR, staging.relativePath)
    const requiredFiles = staging.requiredFiles || []
    const hasModel =
        fs.existsSync(hostModelPath) &&
        requiredFiles.every((fileName) => fs.existsSync(path.join(hostModelPath, fileName)))
    if (hasModel) return MODEL_CACHE_DIR

    if (!staging.archiveUrl) return null

    const archiveFileName = staging.archiveFileName || `${modelId}.tar.bz2`
    const archivePath = path.join(MODEL_CACHE_DIR, 'archives', archiveFileName)
    fs.mkdirSync(path.dirname(archivePath), { recursive: true })

    if (!fs.existsSync(archivePath)) {
        if (process.env.BENCHMARK_ALLOW_MODEL_DOWNLOAD !== '1') {
            throw new Error(
                `Missing Sherpa benchmark model ${modelId}. It was not found in ${staging.sourcePackage} or ${hostModelPath}. ` +
                    `Set BENCHMARK_ALLOW_MODEL_DOWNLOAD=1 to download ${archiveFileName}, or pre-stage the model in sherpa-voice.`,
            )
        }
        run('curl', ['-L', '--fail', '--continue-at', '-', '-o', archivePath, staging.archiveUrl], {
            cwd: REPO_ROOT,
            maxBuffer: 10 * 1024 * 1024,
        })
    }

    const relativeParent = path.posix.dirname(staging.relativePath)
    const hostParent = path.join(MODEL_CACHE_DIR, relativeParent)
    fs.mkdirSync(hostParent, { recursive: true })
    run('tar', ['-xjf', archivePath, '-C', hostParent], {
        cwd: REPO_ROOT,
        maxBuffer: 10 * 1024 * 1024,
    })

    const extracted =
        fs.existsSync(hostModelPath) &&
        requiredFiles.every((fileName) => fs.existsSync(path.join(hostModelPath, fileName)))
    if (!extracted) {
        throw new Error(
            `Downloaded ${archiveFileName}, but expected model files were not found at ${hostModelPath}`,
        )
    }
    return MODEL_CACHE_DIR
}

function bridge(args, parseJson = true) {
    const bridgeArgs = DEVICE ? ['--device', DEVICE, ...args] : args
    return run('node', [BRIDGE, ...bridgeArgs], { parseJson })
}

function resolveHostPath(clip) {
    return clip.hostPath ?? path.join(REPO_ROOT, clip.relativeHostPath)
}

function getDeviceClipPath(clip) {
    if (!clip.deviceFileName) {
        throw new Error(
            `Clip ${clip.id} is missing deviceFileName; set it in asr-eval-manifest.mjs before staging benchmark audio.`,
        )
    }
    return `/data/user/0/${PKG}/files/benchmarks/${clip.deviceFileName}`
}

function isNoTargetError(error) {
    const message = error instanceof Error ? error.message : String(error)
    return (
        message.includes('No debug targets found') ||
        message.includes('No __AGENTIC__ targets found')
    )
}

async function waitForBridgeTarget(timeoutMs = STATE_TIMEOUT_MS) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const devices = bridge(['list-devices'])
            if ((devices?.count ?? 0) > 0) return
        } catch (_error) {
            // Target is not ready yet; keep polling until the timeout expires.
        }
        await sleep(POLL_INTERVAL_MS)
    }
    throw new Error('Timed out waiting for CDP target')
}

async function waitForState(predicate, label, timeoutMs = STATE_TIMEOUT_MS) {
    const startedAt = Date.now()
    let lastError = null

    while (Date.now() - startedAt < timeoutMs) {
        try {
            const state = bridge(['get-state'])
            if (predicate(state)) return state
        } catch (error) {
            lastError = error
        }
        await sleep(POLL_INTERVAL_MS)
    }

    throw new Error(
        `${label} timed out${lastError ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ''}`,
    )
}

async function ensureSherpaBenchmarkModel(model) {
    const staging = SHERPA_MODEL_STAGING[model.id]
    if (!staging) return

    const appPath = `files/${staging.relativePath}`
    const destinationReady = adbShell(
        `run-as ${PKG} sh -c ${shellQuote(`${requiredFilesTest(appPath, staging.requiredFiles)} && echo yes || echo no`)}`,
    ).trim()
    if (destinationReady === 'yes') return

    const sourcePath = `files/${staging.relativePath}`
    let sourceReady = 'no'
    try {
        sourceReady = adb([
            'shell',
            `run-as ${staging.sourcePackage} sh -c ${shellQuote(`${requiredFilesTest(sourcePath, staging.requiredFiles)} && echo yes || echo no`)}`,
        ]).trim()
    } catch (_error) {
        sourceReady = 'no'
    }

    adbShell(`run-as ${PKG} sh -c "mkdir -p files/${path.posix.dirname(staging.relativePath)}"`)
    if (sourceReady === 'yes') {
        run('bash', [
            '-lc',
            `${adbCommandPrefix()} exec-out run-as ${shellQuote(staging.sourcePackage)} tar -C files -cf - ${shellQuote(staging.relativePath)} | ${adbCommandPrefix()} shell run-as ${shellQuote(PKG)} tar -C files -xf -`,
        ])
        return
    }

    const cacheRoot = ensureHostSherpaModel(staging, model.id)
    if (!cacheRoot) {
        throw new Error(
            `Missing Sherpa benchmark model ${model.id}. Download it in ${staging.sourcePackage} or stage ${sourcePath} into ${PKG}.`,
        )
    }

    run('bash', [
        '-lc',
        `tar -C ${shellQuote(cacheRoot)} -cf - ${shellQuote(staging.relativePath)} | ${adbCommandPrefix()} shell run-as ${shellQuote(PKG)} tar -C files -xf -`,
    ])

    const copiedReady = adbShell(
        `run-as ${PKG} sh -c ${shellQuote(`${requiredFilesTest(appPath, staging.requiredFiles)} && echo yes || echo no`)}`,
    ).trim()
    if (copiedReady !== 'yes') {
        throw new Error(`Failed to stage Sherpa benchmark model ${model.id} into ${PKG}`)
    }
}

async function ensureDeviceClip(clip) {
    const hostPath = resolveHostPath(clip)
    const devicePath = getDeviceClipPath(clip)

    if (!fs.existsSync(hostPath)) {
        throw new Error(`Missing host clip for ${clip.id} at ${hostPath}`)
    }

    adbShell(
        `run-as ${PKG} sh -c "mkdir -p ${path.posix.dirname(devicePath)} && rm -f ${devicePath}"`,
    )
    run('bash', [
        '-lc',
        `cat ${shellQuote(hostPath)} | ${
            SERIAL ? `adb -s ${SERIAL}` : 'adb'
        } shell "run-as ${PKG} sh -c 'cat > ${devicePath}'"`,
    ])

    const stagedSize = Number(
        adbShell(`run-as ${PKG} sh -c "wc -c < ${devicePath} 2>/dev/null || echo 0"`).trim() || '0',
    )
    if (stagedSize <= 0) {
        throw new Error(`Failed to stage ${clip.id} into app sandbox at ${devicePath}`)
    }

    return devicePath
}

async function restartDevClient() {
    const metroHost = getMetroHost()
    adb(['reverse', 'tcp:7365', 'tcp:7365'])
    adb(['shell', 'am', 'force-stop', PKG])
    adb([
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        `${DEV_CLIENT_SCHEME}://expo-development-client/?url=http://${metroHost}:7365`,
        PKG,
    ])
    await sleep(5000)
    await waitForBridgeTarget()
}

async function ensureBenchmarkPage() {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            await waitForBridgeTarget()
            bridge(['navigate', ROUTE])
            await waitForState((state) => state?.route === ROUTE, 'benchmark route')
            return
        } catch (error) {
            if (attempt === 2) throw error
            await restartDevClient()
        }
    }
}

async function recoverIfNoTarget(error) {
    if (isNoTargetError(error) || String(error).includes('lost debug target')) {
        await restartDevClient()
        await ensureBenchmarkPage()
        return true
    }
    return false
}

async function callBridgeEval(expression) {
    try {
        return bridge(['eval', expression])
    } catch (error) {
        const recovered = await recoverIfNoTarget(error)
        if (!recovered) throw error
        return bridge(['eval', expression])
    }
}

async function getLastResult() {
    return callBridgeEval('globalThis.__AGENTIC__?.getLastResult?.()')
}

async function waitForAsyncResult(op, timeoutMs, expectedModelId) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
        const result = await getLastResult()
        if (!result || result.op !== op || result.status === 'pending') {
            await sleep(POLL_INTERVAL_MS)
            continue
        }
        const resultModelId = result?.result?.modelId ?? null
        if (expectedModelId && resultModelId && resultModelId !== expectedModelId) {
            await sleep(POLL_INTERVAL_MS)
            continue
        }
        return result
    }
    throw new Error(`${op} timed out after ${timeoutMs}ms`)
}

function normalizeText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function levenshtein(a, b) {
    const rows = a.length + 1
    const cols = b.length + 1
    const dp = Array.from({ length: rows }, () => Array(cols).fill(0))
    for (let i = 0; i < rows; i += 1) dp[i][0] = i
    for (let j = 0; j < cols; j += 1) dp[0][j] = j
    for (let i = 1; i < rows; i += 1) {
        for (let j = 1; j < cols; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
        }
    }
    return dp[a.length][b.length]
}

function scoreTranscript(referenceTranscript, text) {
    const refNorm = normalizeText(referenceTranscript)
    const hypNorm = normalizeText(text)
    const refWords = refNorm ? refNorm.split(' ') : []
    const hypWords = hypNorm ? hypNorm.split(' ') : []
    const refChars = refNorm.split('')
    const hypChars = hypNorm.split('')

    return {
        wer: refWords.length ? levenshtein(refWords, hypWords) / refWords.length : null,
        cer: refChars.length ? levenshtein(refChars, hypChars) / refChars.length : null,
    }
}

function compareQualityResults(a, b) {
    if (a.error && !b.error) return 1
    if (!a.error && b.error) return -1
    const aWer = a.score?.wer
    const bWer = b.score?.wer
    if (aWer != null && bWer != null && aWer !== bWer) return aWer - bWer
    const aLatency = a.recognizeMs ?? Number.MAX_SAFE_INTEGER
    const bLatency = b.recognizeMs ?? Number.MAX_SAFE_INTEGER
    if (aLatency !== bLatency) return aLatency - bLatency
    return String(a.modelId).localeCompare(String(b.modelId))
}

function compareResponsivenessResults(a, b) {
    if (a.error && !b.error) return 1
    if (!a.error && b.error) return -1
    const aProcessingRtf = a.processingRealTimeFactor ?? Number.MAX_SAFE_INTEGER
    const bProcessingRtf = b.processingRealTimeFactor ?? Number.MAX_SAFE_INTEGER
    const aBacklog = a.maxBacklogMs ?? Number.MAX_SAFE_INTEGER
    const bBacklog = b.maxBacklogMs ?? Number.MAX_SAFE_INTEGER
    // Treat simulated-live rows as "keeps up" only when processing is faster
    // than real time and backlog stays bounded. Wall RTF is clock-paced by the
    // replay harness, so it is not a capacity gate.
    const aKeepsUp = aProcessingRtf <= 1 && aBacklog <= 5_000
    const bKeepsUp = bProcessingRtf <= 1 && bBacklog <= 5_000
    if (aKeepsUp !== bKeepsUp) return aKeepsUp ? -1 : 1
    if (aBacklog !== bBacklog) return aBacklog - bBacklog
    if (aProcessingRtf !== bProcessingRtf) return aProcessingRtf - bProcessingRtf
    const aFirstPartial = a.firstPartialMs ?? Number.MAX_SAFE_INTEGER
    const bFirstPartial = b.firstPartialMs ?? Number.MAX_SAFE_INTEGER
    if (aFirstPartial !== bFirstPartial) return aFirstPartial - bFirstPartial
    const aFirstCommit = a.firstCommitMs ?? Number.MAX_SAFE_INTEGER
    const bFirstCommit = b.firstCommitMs ?? Number.MAX_SAFE_INTEGER
    if (aFirstCommit !== bFirstCommit) return aFirstCommit - bFirstCommit
    const aSession = a.sessionMs ?? Number.MAX_SAFE_INTEGER
    const bSession = b.sessionMs ?? Number.MAX_SAFE_INTEGER
    if (aSession !== bSession) return aSession - bSession
    return String(a.modelId).localeCompare(String(b.modelId))
}

function clip(text, max = 180) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function percent(value) {
    return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`
}

function ms(value) {
    return value == null ? 'n/a' : `${Math.round(value)}ms`
}

function seconds(value) {
    return value == null ? 'n/a' : `${(value / 1000).toFixed(1)}s`
}

function ratio(value) {
    return value == null || !Number.isFinite(value) ? 'n/a' : `${value.toFixed(2)}x`
}

function memory(value) {
    return value == null || !Number.isFinite(value) ? 'n/a' : `${(value / 1024).toFixed(1)}MB`
}

function escapeCell(value) {
    return String(value ?? '')
        .replace(/\|/g, '\\|')
        .replace(/\n/g, ' ')
}

async function runOffline(model, clip) {
    const deviceClipPath = getDeviceClipPath(clip)
    await ensureBenchmarkPage()
    const memoryBeforeKb = readAppPssKb()
    await callBridgeEval(
        `globalThis.__AGENTIC__?.benchmarkAsrFile?.(${JSON.stringify(model.id)}, ${JSON.stringify(
            deviceClipPath,
        )})`,
    )
    const result = await waitForAsyncResult('benchmarkAsrFile', OFFLINE_TIMEOUT_MS, model.id)
    const memoryAfterKb = readAppPssKb()
    if (result.status === 'success') {
        return {
            clipId: clip.id,
            clipLabel: clip.label,
            createdAt: Date.now(),
            mode: 'offline',
            modelId: model.id,
            modelName: result.result?.modelName ?? model.id,
            runtime: model.id.startsWith('moonshine') ? 'streaming' : 'offline',
            initMs: result.result?.initMs ?? null,
            memoryAfterKb,
            memoryBeforeKb,
            memoryDeltaKb:
                memoryBeforeKb != null && memoryAfterKb != null
                    ? memoryAfterKb - memoryBeforeKb
                    : null,
            recognizeMs: result.result?.recognizeMs ?? null,
            segmentCount: result.result?.segmentCount ?? null,
            transcript: result.result?.transcript ?? '',
        }
    }
    return {
        clipId: clip.id,
        clipLabel: clip.label,
        createdAt: Date.now(),
        mode: 'offline',
        modelId: model.id,
        modelName: model.id,
        runtime: model.id.startsWith('moonshine') ? 'streaming' : 'offline',
        memoryAfterKb,
        memoryBeforeKb,
        memoryDeltaKb:
            memoryBeforeKb != null && memoryAfterKb != null ? memoryAfterKb - memoryBeforeKb : null,
        error: result.error || 'offline benchmark failed',
        transcript: '',
    }
}

async function runSimulated(model, clip) {
    const deviceClipPath = getDeviceClipPath(clip)
    await ensureBenchmarkPage()
    const memoryBeforeKb = readAppPssKb()
    await callBridgeEval(
        `globalThis.__AGENTIC__?.benchmarkAsrSimulatedLive?.(${JSON.stringify(model.id)}, ${JSON.stringify(
            deviceClipPath,
        )})`,
    )
    const result = await waitForAsyncResult(
        'benchmarkAsrSimulatedLive',
        SIMULATED_TIMEOUT_MS,
        model.id,
    )
    const memoryAfterKb = readAppPssKb()
    if (result.status === 'success') {
        return {
            clipId: clip.id,
            clipLabel: clip.label,
            createdAt: Date.now(),
            mode: 'simulated',
            audioDurationMs: result.result?.audioDurationMs ?? null,
            chunkCount: result.result?.chunkCount ?? null,
            modelId: model.id,
            modelName: result.result?.modelName ?? model.id,
            runtime: result.result?.runtime ?? getSimulatedRuntimeFallback(model),
            commitCount: result.result?.commitCount ?? null,
            firstCommitMs: result.result?.firstCommitMs ?? null,
            firstPartialMs: result.result?.firstPartialMs ?? null,
            initMs: result.result?.initMs ?? null,
            maxBacklogMs: result.result?.maxBacklogMs ?? null,
            maxChunkProcessingMs: result.result?.maxChunkProcessingMs ?? null,
            memoryAfterKb,
            memoryBeforeKb,
            memoryDeltaKb:
                memoryBeforeKb != null && memoryAfterKb != null
                    ? memoryAfterKb - memoryBeforeKb
                    : null,
            partialCount: result.result?.partialCount ?? null,
            processingRealTimeFactor: result.result?.processingRealTimeFactor ?? null,
            sessionMs: result.result?.sessionMs ?? null,
            transcript: result.result?.transcript ?? '',
            wallRealTimeFactor: result.result?.wallRealTimeFactor ?? null,
        }
    }
    return {
        clipId: clip.id,
        clipLabel: clip.label,
        createdAt: Date.now(),
        mode: 'simulated',
        modelId: model.id,
        modelName: model.id,
        runtime: getSimulatedRuntimeFallback(model),
        memoryAfterKb,
        memoryBeforeKb,
        memoryDeltaKb:
            memoryBeforeKb != null && memoryAfterKb != null ? memoryAfterKb - memoryBeforeKb : null,
        error: result.error || 'simulated live benchmark failed',
        transcript: '',
    }
}

function attachScores(results, clip) {
    return results.map((result) => ({
        ...result,
        score:
            result.error || !result.transcript || !clip.referenceTranscript
                ? null
                : scoreTranscript(clip.referenceTranscript, result.transcript),
    }))
}

function average(values) {
    const valid = values.filter((value) => typeof value === 'number' && Number.isFinite(value))
    if (valid.length === 0) return null
    return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

function aggregateByModel(clips, comparator) {
    const grouped = new Map()

    for (const clip of clips) {
        for (const result of clip.results) {
            const entry = grouped.get(result.modelId) ?? {
                modelId: result.modelId,
                modelName: result.modelName || result.modelId,
                runtime: result.runtime,
                clips: [],
            }
            entry.clips.push({
                clipId: clip.id,
                clipLabel: clip.label,
                result,
            })
            grouped.set(result.modelId, entry)
        }
    }

    return Array.from(grouped.values())
        .map((entry) => {
            const results = entry.clips.map((clipResult) => clipResult.result)
            const successes = results.filter((result) => !result.error)
            return {
                ...entry,
                errorCount: results.length - successes.length,
                successfulClipCount: successes.length,
                avgWer: average(successes.map((result) => result.score?.wer)),
                avgCer: average(successes.map((result) => result.score?.cer)),
                avgInitMs: average(successes.map((result) => result.initMs)),
                avgRecognizeMs: average(successes.map((result) => result.recognizeMs)),
                avgFirstPartialMs: average(successes.map((result) => result.firstPartialMs)),
                avgFirstCommitMs: average(successes.map((result) => result.firstCommitMs)),
                avgSessionMs: average(successes.map((result) => result.sessionMs)),
                avgMaxBacklogMs: average(successes.map((result) => result.maxBacklogMs)),
                avgMemoryDeltaKb: average(successes.map((result) => result.memoryDeltaKb)),
                avgProcessingRealTimeFactor: average(
                    successes.map((result) => result.processingRealTimeFactor),
                ),
                avgWallRealTimeFactor: average(
                    successes.map((result) => result.wallRealTimeFactor),
                ),
                avgCommitCount: average(successes.map((result) => result.commitCount)),
                avgPartialCount: average(successes.map((result) => result.partialCount)),
            }
        })
        .sort(comparator)
}

function compareQualityAggregate(a, b) {
    if (a.errorCount !== b.errorCount) return a.errorCount - b.errorCount
    const aWer = a.avgWer ?? Number.MAX_SAFE_INTEGER
    const bWer = b.avgWer ?? Number.MAX_SAFE_INTEGER
    if (aWer !== bWer) return aWer - bWer
    const aRecognize = a.avgRecognizeMs ?? Number.MAX_SAFE_INTEGER
    const bRecognize = b.avgRecognizeMs ?? Number.MAX_SAFE_INTEGER
    if (aRecognize !== bRecognize) return aRecognize - bRecognize
    return String(a.modelId).localeCompare(String(b.modelId))
}

function compareResponsivenessAggregate(a, b) {
    if (a.errorCount !== b.errorCount) return a.errorCount - b.errorCount
    const aProcessingRtf = a.avgProcessingRealTimeFactor ?? Number.MAX_SAFE_INTEGER
    const bProcessingRtf = b.avgProcessingRealTimeFactor ?? Number.MAX_SAFE_INTEGER
    const aBacklog = a.avgMaxBacklogMs ?? Number.MAX_SAFE_INTEGER
    const bBacklog = b.avgMaxBacklogMs ?? Number.MAX_SAFE_INTEGER
    // Same capacity gate as per-clip sorting: processing RTF under 1.0 and
    // backlog under 5s. Wall RTF is clock-paced in simulated-live reports.
    const aKeepsUp = aProcessingRtf <= 1 && aBacklog <= 5_000
    const bKeepsUp = bProcessingRtf <= 1 && bBacklog <= 5_000
    if (aKeepsUp !== bKeepsUp) return aKeepsUp ? -1 : 1
    if (aBacklog !== bBacklog) return aBacklog - bBacklog
    if (aProcessingRtf !== bProcessingRtf) return aProcessingRtf - bProcessingRtf
    const aFirstPartial = a.avgFirstPartialMs ?? Number.MAX_SAFE_INTEGER
    const bFirstPartial = b.avgFirstPartialMs ?? Number.MAX_SAFE_INTEGER
    if (aFirstPartial !== bFirstPartial) return aFirstPartial - bFirstPartial
    const aFirstCommit = a.avgFirstCommitMs ?? Number.MAX_SAFE_INTEGER
    const bFirstCommit = b.avgFirstCommitMs ?? Number.MAX_SAFE_INTEGER
    if (aFirstCommit !== bFirstCommit) return aFirstCommit - bFirstCommit
    return String(a.modelId).localeCompare(String(b.modelId))
}

function compareStreamingTextQualityAggregate(a, b) {
    if (a.errorCount !== b.errorCount) return a.errorCount - b.errorCount
    const aWer = a.avgWer ?? Number.MAX_SAFE_INTEGER
    const bWer = b.avgWer ?? Number.MAX_SAFE_INTEGER
    if (aWer !== bWer) return aWer - bWer
    const aFirstCommit = a.avgFirstCommitMs ?? Number.MAX_SAFE_INTEGER
    const bFirstCommit = b.avgFirstCommitMs ?? Number.MAX_SAFE_INTEGER
    if (aFirstCommit !== bFirstCommit) return aFirstCommit - bFirstCommit
    return String(a.modelId).localeCompare(String(b.modelId))
}

function renderMarkdown(report) {
    const lines = []
    lines.push('# Playground Direct ASR Benchmark Report')
    lines.push('')
    lines.push(`- Generated: ${report.generatedAt}`)
    lines.push(`- Device: ${DEVICE || '(auto-selected by CDP / adb)'}`)
    lines.push(`- Route: ${ROUTE}`)
    if (OFFLINE_MODELS.length > 0) {
        lines.push(`- Models: ${OFFLINE_MODELS.map((model) => model.id).join(', ')}`)
    }
    lines.push('')
    if (report.reproducibility) {
        lines.push('## Reproducibility Metadata')
        lines.push('')
        lines.push(
            `- Git: ${report.reproducibility.git.branch || 'unknown'} @ ${report.reproducibility.git.commit || 'unknown'}${report.reproducibility.git.dirty ? ' (dirty working tree)' : ''}`,
        )
        lines.push(
            `- Package versions: audio-playground ${report.reproducibility.packageVersions.audioPlayground || 'unknown'}, moonshine.rn ${report.reproducibility.packageVersions.moonshineRn || 'unknown'}, sherpa-onnx.rn ${report.reproducibility.packageVersions.sherpaOnnxRn || 'unknown'}`,
        )
        lines.push(
            `- Device build: ${report.reproducibility.device.productManufacturer || ''} ${report.reproducibility.device.productModel || ''}, Android ${report.reproducibility.device.androidRelease || 'unknown'} / API ${report.reproducibility.device.androidSdk || 'unknown'}`,
        )
        lines.push(`- App package: ${report.reproducibility.app.packageName}`)
        lines.push(`- Preset: ${report.reproducibility.benchmarkConfig.preset || '(none)'}`)
        lines.push(`- Model cache: ${report.reproducibility.benchmarkConfig.modelCacheDir}`)
        lines.push('')
        lines.push('| Model | Engine | Source | Device fingerprint status |')
        lines.push('| --- | --- | --- | --- |')
        for (const model of report.reproducibility.selectedModels) {
            const source =
                model.sourceBaseUrl ||
                model.sourceArchiveUrl ||
                model.sourcePackage ||
                model.note ||
                ''
            const fileCount = model.files?.length ?? 0
            const hashedCount = model.files?.filter((file) => file.device?.sha256).length ?? 0
            const missingCount =
                model.files?.filter((file) => file.device?.exists === false).length ?? 0
            lines.push(
                `| ${escapeCell(model.modelId)} | ${escapeCell(model.engine)} | ${escapeCell(source)} | ${escapeCell(`${hashedCount}/${fileCount} hashed${missingCount ? `, ${missingCount} missing` : ''}`)} |`,
            )
        }
        lines.push('')
        lines.push(
            'Full JSON includes per-file SHA-256 fingerprints for staged clips and configured model files.',
        )
        lines.push('')
    }
    lines.push('## Evaluation Set')
    lines.push('')
    for (const clip of report.evalSet) {
        lines.push(`- ${clip.label}: ${clip.description}`)
        lines.push(`  Source: ${clip.transcriptSource}`)
    }
    lines.push('')
    lines.push('## Quality Benchmark')
    lines.push('')
    lines.push(
        'Offline/file transcription on identical staged WAV clips. This is the fair text-quality comparison.',
    )
    lines.push(
        'File-mode runtime labels describe the recognizer path for a full staged file; rolling-offline labels are reserved for simulated delayed-live/windowed runs.',
    )
    lines.push('')
    lines.push(
        '| Model | Avg WER | Avg CER | Avg init | Avg recognize | Avg memory delta | Successful clips | Errors |',
    )
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const item of report.quality.aggregate) {
        lines.push(
            `| ${escapeCell(item.modelName || item.modelId)} | ${escapeCell(percent(item.avgWer))} | ${escapeCell(percent(item.avgCer))} | ${escapeCell(ms(item.avgInitMs))} | ${escapeCell(ms(item.avgRecognizeMs))} | ${escapeCell(memory(item.avgMemoryDeltaKb))} | ${escapeCell(item.successfulClipCount)} | ${escapeCell(item.errorCount)} |`,
        )
    }
    lines.push('')
    for (const clip of report.quality.clips) {
        lines.push(`### ${clip.label}`)
        lines.push('')
        lines.push(
            `Reference: ${clip.referenceTranscript ?? 'Unavailable in repo; performance-only clip'}`,
        )
        lines.push('')
        lines.push(
            '| Model | WER | CER | Init | Recognize | Memory delta | Segments | Error | Transcript |',
        )
        lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
        for (const item of clip.results) {
            lines.push(
                `| ${escapeCell(item.modelName || item.modelId)} | ${escapeCell(percent(item.score?.wer))} | ${escapeCell(percent(item.score?.cer))} | ${escapeCell(ms(item.initMs))} | ${escapeCell(ms(item.recognizeMs))} | ${escapeCell(memory(item.memoryDeltaKb))} | ${escapeCell(item.segmentCount ?? 'n/a')} | ${escapeCell(item.error || '')} | ${escapeCell(clipText(item.transcript))} |`,
            )
        }
        lines.push('')
    }
    lines.push('## Live Responsiveness Benchmark')
    lines.push('')
    lines.push('Simulated live feeds the identical PCM waveform directly into each runtime.')
    lines.push('')
    lines.push(
        'Whisper is pseudo-streaming here: it repeatedly re-decodes cumulative audio and its diagnostic WER should not be treated as a true streaming quality leaderboard.',
    )
    lines.push(
        'Wall RTF is clock-paced by simulated replay; processing RTF and max backlog are the capacity signals.',
    )
    lines.push('')
    lines.push(
        '| Model | Runtime | Avg init | First partial | First commit | Processing RTF | Max backlog | Wall RTF | Memory delta | Diagnostic WER | Successful clips | Errors |',
    )
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const item of report.liveResponsiveness.aggregate) {
        lines.push(
            `| ${escapeCell(item.modelName || item.modelId)} | ${escapeCell(item.runtime)} | ${escapeCell(ms(item.avgInitMs))} | ${escapeCell(ms(item.avgFirstPartialMs))} | ${escapeCell(ms(item.avgFirstCommitMs))} | ${escapeCell(ratio(item.avgProcessingRealTimeFactor))} | ${escapeCell(seconds(item.avgMaxBacklogMs))} | ${escapeCell(ratio(item.avgWallRealTimeFactor))} | ${escapeCell(memory(item.avgMemoryDeltaKb))} | ${escapeCell(percent(item.avgWer))} | ${escapeCell(item.successfulClipCount)} | ${escapeCell(item.errorCount)} |`,
        )
    }
    lines.push('')
    for (const clip of report.liveResponsiveness.clips) {
        lines.push(`### ${clip.label}`)
        lines.push('')
        lines.push(
            '| Model | Runtime | Audio | First partial | First commit | Session | Processing RTF | Max backlog | Wall RTF | Memory delta | Diagnostic WER | Commits | Partials | Error | Transcript |',
        )
        lines.push(
            '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        )
        for (const item of clip.results) {
            lines.push(
                `| ${escapeCell(item.modelName || item.modelId)} | ${escapeCell(item.runtime)} | ${escapeCell(seconds(item.audioDurationMs))} | ${escapeCell(ms(item.firstPartialMs))} | ${escapeCell(ms(item.firstCommitMs))} | ${escapeCell(ms(item.sessionMs))} | ${escapeCell(ratio(item.processingRealTimeFactor))} | ${escapeCell(seconds(item.maxBacklogMs))} | ${escapeCell(ratio(item.wallRealTimeFactor))} | ${escapeCell(memory(item.memoryDeltaKb))} | ${escapeCell(percent(item.score?.wer))} | ${escapeCell(item.commitCount ?? '')} | ${escapeCell(item.partialCount ?? '')} | ${escapeCell(item.error || '')} | ${escapeCell(clipText(item.transcript))} |`,
            )
        }
        lines.push('')
    }
    lines.push('## Summary')
    lines.push('')
    if (report.summary.bestQuality) {
        lines.push(
            `- Best quality: ${report.summary.bestQuality.modelName} (${percent(report.summary.bestQuality.avgWer)} average WER).`,
        )
    }
    if (report.summary.bestResponsiveness) {
        lines.push(
            `- Best live responsiveness: ${report.summary.bestResponsiveness.modelName} (${ms(report.summary.bestResponsiveness.avgFirstPartialMs)} average first partial, ${ms(report.summary.bestResponsiveness.avgFirstCommitMs)} average first commit, ${ratio(report.summary.bestResponsiveness.avgProcessingRealTimeFactor)} processing RTF, ${seconds(report.summary.bestResponsiveness.avgMaxBacklogMs)} max backlog).`,
        )
    }
    if (report.summary.bestStreamingTextQuality) {
        lines.push(
            `- Best true-streaming diagnostic text quality: ${report.summary.bestStreamingTextQuality.modelName} (${percent(report.summary.bestStreamingTextQuality.avgWer)} average diagnostic WER).`,
        )
    }
    lines.push('')
    return `${lines.join('\n')}\n`
}

function clipText(text, max = 180) {
    return clip(text, max)
}

async function main() {
    if (OFFLINE_MODELS.length === 0) {
        throw new Error('No models selected. Check BENCHMARK_MODELS.')
    }
    if (EVAL_CLIPS.length === 0) {
        throw new Error('No clips selected. Check BENCHMARK_CLIPS.')
    }

    await ensureBenchmarkPage()
    for (const model of OFFLINE_MODELS) {
        await ensureSherpaBenchmarkModel(model)
    }

    const qualityClips = []
    const liveClips = []

    for (const clip of EVAL_CLIPS) {
        await ensureDeviceClip(clip)

        if (clip.modes.includes('offline')) {
            const offlineResults = []
            for (const model of OFFLINE_MODELS) {
                offlineResults.push(await runOffline(model, clip))
            }
            qualityClips.push({
                ...clip,
                deviceClip: getDeviceClipPath(clip),
                results: attachScores(offlineResults, clip).sort(compareQualityResults),
            })
        }

        if (clip.modes.includes('simulated')) {
            const simulatedResults = []
            for (const model of SIMULATED_MODELS) {
                simulatedResults.push(await runSimulated(model, clip))
            }
            liveClips.push({
                ...clip,
                deviceClip: getDeviceClipPath(clip),
                results: attachScores(simulatedResults, clip).sort(compareResponsivenessResults),
            })
        }
    }

    const qualityAggregate = aggregateByModel(qualityClips, compareQualityAggregate)
    const liveAggregate = aggregateByModel(liveClips, compareResponsivenessAggregate)
    const trueStreamingAggregate = aggregateByModel(
        liveClips
            .filter((clip) => clip.results.some((result) => result.runtime === 'streaming'))
            .map((clip) => ({
                ...clip,
                results: clip.results.filter((result) => result.runtime === 'streaming'),
            })),
        compareStreamingTextQualityAggregate,
    )

    const generatedAt = new Date().toISOString()
    const report = {
        generatedAt,
        reproducibility: collectReproducibilityMetadata(generatedAt),
        evalSet: EVAL_CLIPS.map((clip) => ({
            ...clip,
            hostPath: resolveHostPath(clip),
            deviceClip: getDeviceClipPath(clip),
        })),
        quality: {
            clips: qualityClips,
            aggregate: qualityAggregate,
        },
        liveResponsiveness: {
            clips: liveClips,
            aggregate: liveAggregate,
        },
        summary: {
            bestQuality: qualityAggregate.find((item) => item.errorCount === 0) ?? null,
            bestResponsiveness: liveAggregate.find((item) => item.errorCount === 0) ?? null,
            bestStreamingTextQuality:
                trueStreamingAggregate.find((item) => item.errorCount === 0) ?? null,
        },
    }

    const timestamp = report.generatedAt.replace(/[:.]/g, '-')
    const jsonPath = path.join(REPORT_DIR, `direct-asr-benchmark-${timestamp}.json`)
    const mdPath = path.join(REPORT_DIR, `direct-asr-benchmark-${timestamp}.md`)
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
    fs.writeFileSync(mdPath, renderMarkdown(report))
    console.log(
        JSON.stringify({ report: jsonPath, markdown: mdPath, summary: report.summary }, null, 2),
    )
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
})
