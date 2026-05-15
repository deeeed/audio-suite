#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, '..')
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..')
const APP_ROOT = path.join(REPO_ROOT, 'apps', 'playground')
const BRIDGE = path.join(APP_ROOT, 'scripts', 'agentic', 'cdp-bridge.mjs')
const DEFAULT_FIXTURE = path.join(
    REPO_ROOT,
    '.agent',
    'fixtures',
    'perps_controller_refactor_100m.opus'
)
const APP_VARIANT = process.env.APP_VARIANT || 'development'
const PACKAGE_NAME =
    APP_VARIANT === 'production'
        ? 'net.siteed.audioplayground'
        : `net.siteed.audioplayground.${APP_VARIANT}`
const SERIAL = process.env.ANDROID_SERIAL || process.env.ADB_SERIAL || ''
let TARGET_DEVICE =
    process.env.AGENTIC_DEVICE || process.env.BENCHMARK_DEVICE || ''
let TARGET_PLATFORM = process.env.LONG_AUDIO_PLATFORM || 'android'
const POLL_INTERVAL_MS = Number.parseInt(
    process.env.POLL_INTERVAL_MS || '5000',
    10
)
const TIMEOUT_MS = Number.parseInt(
    process.env.LONG_AUDIO_TIMEOUT_MS || String(45 * 60 * 1000),
    10
)
const DEFAULT_STALL_TIMEOUT_MS = Number.parseInt(
    process.env.LONG_AUDIO_STALL_TIMEOUT_MS || String(5 * 60 * 1000),
    10
)
const HEARTBEAT_INTERVAL_MS = Number.parseInt(
    process.env.LONG_AUDIO_HEARTBEAT_MS || String(30 * 1000),
    10
)
const BRIDGE_GRACE_MS = Number.parseInt(
    process.env.LONG_AUDIO_BRIDGE_GRACE_MS || String(30 * 1000),
    10
)

function parseArgs(argv) {
    const out = {
        mode: 'decode-only',
        fixture: process.env.AUDIO_FIXTURE || DEFAULT_FIXTURE,
        modelId:
            process.env.MOONSHINE_MODEL_ID || 'moonshine-small-streaming-en',
        sherpaConfig: process.env.SHERPA_ASR_CONFIG_JSON
            ? parseSherpaConfig(process.env.SHERPA_ASR_CONFIG_JSON)
            : undefined,
        sherpaModelSource: process.env.SHERPA_MODEL_SOURCE,
        sherpaModelHostDir: process.env.SHERPA_MODEL_HOST_DIR,
        sherpaModelTargetDir: process.env.SHERPA_MODEL_TARGET_DIR,
        sherpaReleaseBetweenSegments:
            process.env.SHERPA_RELEASE_BETWEEN_SEGMENTS !== undefined
                ? process.env.SHERPA_RELEASE_BETWEEN_SEGMENTS !== '0' &&
                  process.env.SHERPA_RELEASE_BETWEEN_SEGMENTS !== 'false'
                : undefined,
        moonshineFeedMode: process.env.MOONSHINE_FEED_MODE || 'typed-array',
        startTimeMs: process.env.START_TIME_MS
            ? Number.parseInt(process.env.START_TIME_MS, 10)
            : undefined,
        endTimeMs: process.env.END_TIME_MS
            ? Number.parseInt(process.env.END_TIME_MS, 10)
            : undefined,
        chunkDurationMs: Number.parseInt(
            process.env.CHUNK_DURATION_MS || '250',
            10
        ),
        maxBufferedChunks: Number.parseInt(
            process.env.MAX_BUFFERED_CHUNKS || '4',
            10
        ),
        progressEveryChunks: Number.parseInt(
            process.env.PROGRESS_EVERY_CHUNKS || '40',
            10
        ),
        sherpaSegmentDurationMs: Number.parseInt(
            process.env.SHERPA_SEGMENT_DURATION_MS || '30000',
            10
        ),
        cancelAfterChunks: process.env.CANCEL_AFTER_CHUNKS
            ? Number.parseInt(process.env.CANCEL_AFTER_CHUNKS, 10)
            : undefined,
        maxPssKb: process.env.MAX_PSS_KB
            ? Number.parseInt(process.env.MAX_PSS_KB, 10)
            : undefined,
        maxNativeHeapKb: process.env.MAX_NATIVE_HEAP_KB
            ? Number.parseInt(process.env.MAX_NATIVE_HEAP_KB, 10)
            : undefined,
        stallTimeoutMs: DEFAULT_STALL_TIMEOUT_MS,
        device: TARGET_DEVICE,
        platform: TARGET_PLATFORM,
    }

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i]
        if (arg === '--decode-only') out.mode = 'decode-only'
        else if (arg === '--full-decode') out.mode = 'full-decode'
        else if (arg === '--moonshine') out.mode = 'moonshine'
        else if (arg === '--sherpa-online') out.mode = 'sherpa-online'
        else if (arg === '--sherpa-offline-segments')
            out.mode = 'sherpa-offline-segments'
        else if (arg === '--fixture') out.fixture = argv[++i]
        else if (arg === '--model-id') out.modelId = argv[++i]
        else if (arg === '--sherpa-config') {
            const value = argv[++i]
            out.sherpaConfig = parseSherpaConfig(value)
        } else if (arg === '--stage-sherpa-model-from')
            out.sherpaModelSource = argv[++i]
        else if (arg === '--stage-sherpa-model-host-dir')
            out.sherpaModelHostDir = argv[++i]
        else if (arg === '--stage-sherpa-model-to')
            out.sherpaModelTargetDir = argv[++i]
        else if (arg === '--sherpa-release-between-segments')
            out.sherpaReleaseBetweenSegments = true
        else if (arg === '--no-sherpa-release-between-segments')
            out.sherpaReleaseBetweenSegments = false
        else if (arg === '--feed') out.moonshineFeedMode = argv[++i]
        else if (arg === '--start-ms')
            out.startTimeMs = Number.parseInt(argv[++i], 10)
        else if (arg === '--end-ms')
            out.endTimeMs = Number.parseInt(argv[++i], 10)
        else if (arg === '--limit-ms') {
            const limitMs = Number.parseInt(argv[++i], 10)
            out.endTimeMs = (out.startTimeMs || 0) + limitMs
        } else if (arg === '--chunk-duration-ms')
            out.chunkDurationMs = Number.parseInt(argv[++i], 10)
        else if (arg === '--max-buffered-chunks')
            out.maxBufferedChunks = Number.parseInt(argv[++i], 10)
        else if (arg === '--progress-every-chunks')
            out.progressEveryChunks = Number.parseInt(argv[++i], 10)
        else if (arg === '--sherpa-segment-duration-ms')
            out.sherpaSegmentDurationMs = Number.parseInt(argv[++i], 10)
        else if (arg === '--cancel-after-chunks')
            out.cancelAfterChunks = Number.parseInt(argv[++i], 10)
        else if (arg === '--max-pss-kb')
            out.maxPssKb = Number.parseInt(argv[++i], 10)
        else if (arg === '--max-native-heap-kb')
            out.maxNativeHeapKb = Number.parseInt(argv[++i], 10)
        else if (arg === '--stall-timeout-ms')
            out.stallTimeoutMs = Number.parseInt(argv[++i], 10)
        else if (arg === '--device') out.device = argv[++i]
        else if (arg === '--platform') out.platform = argv[++i]
        else if (arg === '--help' || arg === '-h') {
            printHelp()
            process.exit(0)
        } else {
            throw new Error(`Unknown argument: ${arg}`)
        }
    }
    return out
}

function printHelp() {
    console.log(
        `Usage: yarn validate:stream-long [--decode-only|--full-decode|--moonshine|--sherpa-online|--sherpa-offline-segments] [options]\n\nOptions:\n  --fixture <path>               Host audio fixture path (default AUDIO_FIXTURE or repo 100m opus)\n  --model-id <id>                Moonshine model id (default moonshine-small-streaming-en)\n  --sherpa-config <json|path>    Sherpa AsrModelConfig JSON or path\n  --stage-sherpa-model-from <package:path>\n                                Copy a downloaded Sherpa model dir from another debug app sandbox\n  --stage-sherpa-model-host-dir <path>\n                                Copy a Sherpa model dir from host into the target app sandbox\n  --stage-sherpa-model-to <path> Destination modelDir (default: sherpa-config.modelDir)\n  --sherpa-segment-duration-ms <n> Segment length for --sherpa-offline-segments (default 30000)\n  --sherpa-release-between-segments / --no-sherpa-release-between-segments\n                                Release/reinitialize offline ASR after each segment (default: true for Qwen3)\n  --feed <typed-array|array-copy> Moonshine feed mode (default typed-array)\n  --start-ms <n>                 Decode/transcribe range start in ms (default 0)\n  --end-ms <n>                   Decode/transcribe range end in ms (default EOF)\n  --limit-ms <n>                 Range length from --start-ms/0, e.g. 300000 for 5 min\n  --chunk-duration-ms <n>        Decode chunk size in ms (default 250)\n  --max-buffered-chunks <n>      Native backpressure window (default 4)\n  --progress-every-chunks <n>    App-side progress update cadence (default 40)\n  --cancel-after-chunks <n>      Cancel early after n chunks (smoke-tests cancellation)\n  --max-pss-kb <n>               Cancel and fail if TOTAL PSS exceeds this budget\n  --max-native-heap-kb <n>       Cancel and fail if Native Heap exceeds this budget\n  --stall-timeout-ms <n>         Cancel and fail if chunk progress stalls (default 300000)\n  --platform <android|ios|auto>  Target app platform (default LONG_AUDIO_PLATFORM or android)\n  --device <name>                Agentic device name substring (default AGENTIC_DEVICE/BENCHMARK_DEVICE)\n\nEnvironment:\n  AUDIO_FIXTURE, ANDROID_SERIAL/ADB_SERIAL, AGENTIC_DEVICE, BENCHMARK_DEVICE,\n  IOS_DEVICE_UDID, APP_VARIANT,\n  LONG_AUDIO_PLATFORM, LONG_AUDIO_TIMEOUT_MS, LONG_AUDIO_STALL_TIMEOUT_MS,\n  LONG_AUDIO_HEARTBEAT_MS, LONG_AUDIO_BRIDGE_GRACE_MS, POLL_INTERVAL_MS,\n  MOONSHINE_MODEL_ID, MOONSHINE_FEED_MODE, SHERPA_ASR_CONFIG_JSON,\n  SHERPA_SEGMENT_DURATION_MS, SHERPA_MODEL_SOURCE, SHERPA_MODEL_HOST_DIR,\n  SHERPA_MODEL_TARGET_DIR, SHERPA_RELEASE_BETWEEN_SEGMENTS, START_TIME_MS,\n  END_TIME_MS, CHUNK_DURATION_MS, MAX_BUFFERED_CHUNKS,\n  PROGRESS_EVERY_CHUNKS, CANCEL_AFTER_CHUNKS, MAX_PSS_KB, MAX_NATIVE_HEAP_KB\n`
    )
}

function run(
    command,
    args,
    { cwd = REPO_ROOT, parseJson = false, maxBuffer = 50 * 1024 * 1024 } = {}
) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, APP_ROOT },
        maxBuffer,
    })
    if (result.status !== 0) {
        const output = [result.stdout, result.stderr]
            .filter(Boolean)
            .join('\n')
            .trim()
        throw new Error(output || `${command} ${args.join(' ')} failed`)
    }
    const stdout = (result.stdout || '').trim()
    return parseJson ? (stdout ? JSON.parse(stdout) : null) : stdout
}

function adb(args) {
    return run('adb', SERIAL ? ['-s', SERIAL, ...args] : args)
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function bridge(args, parseJson = true) {
    return run(
        'node',
        [
            BRIDGE,
            ...(TARGET_DEVICE ? ['--device', TARGET_DEVICE] : []),
            ...args,
        ],
        {
            cwd: APP_ROOT,
            parseJson,
        }
    )
}

function expandConfigPlaceholders(value) {
    if (typeof value === 'string') {
        return value
            .replaceAll('${ANDROID_PACKAGE_NAME}', PACKAGE_NAME)
            .replaceAll('${APP_VARIANT}', APP_VARIANT)
    }
    if (Array.isArray(value)) {
        return value.map((item) => expandConfigPlaceholders(item))
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [
                key,
                expandConfigPlaceholders(entry),
            ])
        )
    }
    return value
}

function parseSherpaConfig(value) {
    const maybePath = path.isAbsolute(value)
        ? value
        : path.resolve(process.cwd(), value)
    const raw = fs.existsSync(maybePath)
        ? fs.readFileSync(maybePath, 'utf8')
        : value
    return expandConfigPlaceholders(JSON.parse(raw))
}

function normalizeDevices(devicesPayload) {
    if (Array.isArray(devicesPayload)) return devicesPayload
    if (Array.isArray(devicesPayload?.devices)) return devicesPayload.devices
    return []
}

function selectTargetDevice(devicesPayload, options) {
    const devices = normalizeDevices(devicesPayload)
    const requestedPlatform = (options.platform || 'android').toLowerCase()
    const requestedDevice = options.device?.toLowerCase()
    let candidates = devices

    if (requestedPlatform !== 'auto') {
        candidates = candidates.filter(
            (device) => device.platform === requestedPlatform
        )
    }
    if (requestedDevice) {
        candidates = candidates.filter((device) =>
            String(device.name || '')
                .toLowerCase()
                .includes(requestedDevice)
        )
    }

    if (candidates.length !== 1) {
        const available = devices
            .map(
                (device) =>
                    `${device.name} (${device.platform}/${device.targetType || 'unknown'})`
            )
            .join(', ')
        throw new Error(
            `Expected exactly one target device for platform=${requestedPlatform} device=${
                options.device || '(auto)'
            }, found ${candidates.length}. Available: ${available || '(none)'}`
        )
    }

    const selected = candidates[0]
    TARGET_DEVICE = options.device || toBridgeDeviceName(selected)
    TARGET_PLATFORM = selected.platform
    return selected
}

function toBridgeDeviceName(device) {
    const name = String(device.name || '')
    if (name.startsWith('sim:')) return name.slice('sim:'.length)
    if (name.startsWith('device:')) {
        return name.slice('device:'.length).split(/[’']/)[0].trim()
    }
    return name
}

function emit(event, payload = {}) {
    console.log(
        JSON.stringify({ event, at: new Date().toISOString(), ...payload })
    )
}

function resolveFixture(inputPath) {
    if (path.isAbsolute(inputPath)) {
        return inputPath
    }
    const cwdPath = path.resolve(process.cwd(), inputPath)
    if (fs.existsSync(cwdPath)) {
        return cwdPath
    }
    return path.resolve(REPO_ROOT, inputPath)
}

function stageFixture(hostPath) {
    if (!fs.existsSync(hostPath)) {
        throw new Error(`Fixture not found: ${hostPath}`)
    }
    const basename = path.basename(hostPath).replace(/[^a-zA-Z0-9._-]/g, '_')
    const devicePath = `/data/user/0/${PACKAGE_NAME}/files/agent-fixtures/${basename}`
    adb([
        'shell',
        `run-as ${PACKAGE_NAME} sh -c ${shellQuote(`mkdir -p ${path.posix.dirname(devicePath)} && rm -f ${devicePath}`)}`,
    ])
    run('bash', [
        '-lc',
        `cat ${shellQuote(hostPath)} | ${SERIAL ? `adb -s ${shellQuote(SERIAL)}` : 'adb'} shell ${shellQuote(`run-as ${PACKAGE_NAME} sh -c 'cat > ${devicePath}'`)}`,
    ])
    const size = Number(
        adb([
            'shell',
            `run-as ${PACKAGE_NAME} sh -c ${shellQuote(`wc -c < ${devicePath} 2>/dev/null || echo 0`)}`,
        ]).trim() || '0'
    )
    if (size <= 0) {
        throw new Error(`Failed to stage fixture to ${devicePath}`)
    }
    return { devicePath, size }
}

function getBootedSimulatorUdid(deviceName) {
    const wanted = String(deviceName || '')
        .replace(/^sim:/, '')
        .toLowerCase()
    const payload = run(
        'xcrun',
        ['simctl', 'list', 'devices', 'booted', '-j'],
        {
            parseJson: true,
        }
    )
    const booted = Object.values(payload.devices || {})
        .flat()
        .filter((device) => device.state === 'Booted')
    const matches = wanted
        ? booted.filter(
              (device) =>
                  device.udid.toLowerCase() === wanted ||
                  device.name.toLowerCase() === wanted ||
                  device.name.toLowerCase().includes(wanted)
          )
        : booted
    if (matches.length !== 1) {
        throw new Error(
            `Expected one booted simulator for ${deviceName}, found ${matches.length}: ${booted
                .map((device) => `${device.name}:${device.udid}`)
                .join(', ')}`
        )
    }
    return matches[0].udid
}

function stageFixtureIOSSimulator(hostPath, selectedDevice) {
    if (!fs.existsSync(hostPath)) {
        throw new Error(`Fixture not found: ${hostPath}`)
    }
    if (selectedDevice.targetType !== 'simulator') {
        throw new Error(
            'iOS physical fixture staging is not implemented; use an iOS simulator or Android device'
        )
    }
    const udid = getBootedSimulatorUdid(selectedDevice.name)
    const container = run('xcrun', [
        'simctl',
        'get_app_container',
        udid,
        PACKAGE_NAME,
        'data',
    ]).trim()
    const basename = path.basename(hostPath).replace(/[^a-zA-Z0-9._-]/g, '_')
    const targetDir = path.join(container, 'Documents', 'agent-fixtures')
    const targetPath = path.join(targetDir, basename)
    fs.mkdirSync(targetDir, { recursive: true })
    fs.copyFileSync(hostPath, targetPath)
    const size = fs.statSync(targetPath).size
    if (size <= 0) {
        throw new Error(`Failed to stage fixture to ${targetPath}`)
    }
    return {
        devicePath: `file://${targetPath}`,
        size,
        simulatorUdid: udid,
        container,
    }
}

function findIOSPhysicalDeviceIdentifier(selectedDevice) {
    if (process.env.IOS_DEVICE_UDID) return process.env.IOS_DEVICE_UDID

    const wantedName = String(selectedDevice?.name || '')
        .replace(/^device:/, '')
        .replace(/^ios:/, '')
        .trim()
    const output = run('xcrun', ['devicectl', 'list', 'devices', '-v'])
    const blocks = output.split(/(?=▿ .+ - [0-9A-F]{8}-)/)
    const physicalDevices = blocks
        .filter((block) => block.includes('physical'))
        .map((block) => ({
            block,
            name:
                block.match(/name: Optional\("([^"]+)"\)/)?.[1] ||
                block.match(/marketingName: Optional\("([^"]+)"\)/)?.[1] ||
                '',
            udid: block.match(/udid: Optional\("([^"]+)"\)/)?.[1] || '',
            identifier:
                block.match(/identifier: ([0-9A-F-]+)/)?.[1] ||
                block.match(/^▿ .+ - ([0-9A-F-]+)/m)?.[1] ||
                '',
        }))
        .filter((device) => device.udid || device.identifier)

    const normalizedWanted = wantedName.toLowerCase()
    const matches = normalizedWanted
        ? physicalDevices.filter((device) => {
              const normalizedName = device.name.toLowerCase()
              return (
                  normalizedName === normalizedWanted ||
                  normalizedName.includes(normalizedWanted) ||
                  normalizedWanted.includes(normalizedName)
              )
          })
        : physicalDevices

    if (matches.length !== 1) {
        throw new Error(
            `Expected one iOS physical device for ${wantedName || '(auto)'}, found ${
                matches.length
            }. Available: ${physicalDevices
                .map(
                    (device) =>
                        `${device.name || '(unnamed)'}:${device.udid || device.identifier}`
                )
                .join(', ')}`
        )
    }

    return matches[0].udid || matches[0].identifier
}

function stageFixtureIOSPhysical(hostPath, selectedDevice) {
    if (!fs.existsSync(hostPath)) {
        throw new Error(`Fixture not found: ${hostPath}`)
    }

    const deviceIdentifier = findIOSPhysicalDeviceIdentifier(selectedDevice)
    const basename = path.basename(hostPath).replace(/[^a-zA-Z0-9._-]/g, '_')
    const relativePath = `agent-fixtures/${basename}`
    const destination = `Documents/${relativePath}`
    const output = run('xcrun', [
        'devicectl',
        'device',
        'copy',
        'to',
        '--device',
        deviceIdentifier,
        '--domain-type',
        'appDataContainer',
        '--domain-identifier',
        PACKAGE_NAME,
        '--source',
        hostPath,
        '--destination',
        destination,
        '--remove-existing-content',
        'false',
    ])
    const targetPath =
        output.match(/^Path: (.+)$/m)?.[1]?.trim() ||
        output.match(/Path:\s+(.+)$/m)?.[1]?.trim()
    const size = fs.statSync(hostPath).size
    if (!targetPath || size <= 0) {
        throw new Error(
            `Failed to stage iOS physical fixture to ${destination}; devicectl output: ${output}`
        )
    }

    return {
        devicePath: `file://${targetPath}`,
        size,
        iosDeviceIdentifier: deviceIdentifier,
        relativePath,
    }
}

function stageFixtureForTarget(hostPath, selectedDevice) {
    if (selectedDevice.platform === 'android') {
        return stageFixture(hostPath)
    }
    if (selectedDevice.platform === 'ios') {
        return selectedDevice.targetType === 'physical'
            ? stageFixtureIOSPhysical(hostPath, selectedDevice)
            : stageFixtureIOSSimulator(hostPath, selectedDevice)
    }
    throw new Error(
        `Unsupported platform for fixture staging: ${selectedDevice.platform}`
    )
}

function parsePackagePath(value) {
    const separator = value?.indexOf(':') ?? -1
    if (!value || separator <= 0 || separator === value.length - 1) {
        throw new Error(
            `Expected package:path for --stage-sherpa-model-from, got ${value}`
        )
    }
    const packageName = value.slice(0, separator)
    if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(packageName)) {
        throw new Error(
            `Invalid Android package name for --stage-sherpa-model-from: ${packageName}`
        )
    }
    return {
        packageName,
        path: value.slice(separator + 1),
    }
}

function toRunAsPath(packageName, inputPath) {
    const dataPrefix = `/data/user/0/${packageName}/`
    return inputPath.startsWith(dataPrefix)
        ? inputPath.slice(dataPrefix.length)
        : inputPath
}

function stageSherpaModelFromPackage(options) {
    if (!options.sherpaModelSource) return null
    if (TARGET_PLATFORM !== 'android') {
        throw new Error('--stage-sherpa-model-from is currently Android-only')
    }
    const targetDir =
        options.sherpaModelTargetDir || options.sherpaConfig?.modelDir
    if (!targetDir) {
        throw new Error(
            '--stage-sherpa-model-from requires --stage-sherpa-model-to or sherpa-config.modelDir'
        )
    }

    const source = parsePackagePath(options.sherpaModelSource)
    const sourcePath = toRunAsPath(source.packageName, source.path)
    const targetPath = toRunAsPath(PACKAGE_NAME, targetDir)
    const quotedSourcePath = shellQuote(sourcePath)
    const quotedTargetPath = shellQuote(targetPath)
    const adbPrefix = SERIAL ? `adb -s ${shellQuote(SERIAL)}` : 'adb'
    const sourceCommand = `${adbPrefix} exec-out ${shellQuote(
        `run-as ${source.packageName} sh -c ${shellQuote(`cd ${quotedSourcePath} && tar -cf - .`)}`
    )}`
    const targetCommand = `${adbPrefix} shell ${shellQuote(
        `run-as ${PACKAGE_NAME} sh -c ${shellQuote(
            `rm -rf ${quotedTargetPath} && mkdir -p ${quotedTargetPath} && cd ${quotedTargetPath} && tar -xf -`
        )}`
    )}`

    run('bash', ['-lc', `${sourceCommand} | ${targetCommand}`], {
        maxBuffer: 10 * 1024 * 1024,
    })

    const listing = adb([
        'shell',
        `run-as ${PACKAGE_NAME} sh -c ${shellQuote(
            `find ${shellQuote(targetPath)} -maxdepth 2 -type f | sed 's#^${targetPath}/##' | sort | head -50`
        )}`,
    ])
    return {
        sourcePackage: source.packageName,
        sourcePath: source.path,
        targetDir,
        files: listing.split('\n').filter(Boolean),
    }
}

function normalizeIOSDocumentsRelativePath(value, fallback) {
    const raw = String(value || fallback || '').trim()
    return raw
        .replace(/^file:\/\//, '')
        .replace(
            /^\/private\/var\/mobile\/Containers\/Data\/Application\/[^/]+\/Documents\//,
            ''
        )
        .replace(
            /^\/var\/mobile\/Containers\/Data\/Application\/[^/]+\/Documents\//,
            ''
        )
        .replace(/^Documents\//, '')
        .replace(/^\/+/, '')
}

function stageSherpaHostModel(options, selectedDevice) {
    if (!options.sherpaModelHostDir) return null

    const hostDir = path.isAbsolute(options.sherpaModelHostDir)
        ? options.sherpaModelHostDir
        : path.resolve(process.cwd(), options.sherpaModelHostDir)
    if (!fs.existsSync(hostDir) || !fs.statSync(hostDir).isDirectory()) {
        throw new Error(`Sherpa host model dir not found: ${hostDir}`)
    }

    const fallbackRelativeTarget = `sherpa-onnx/asr/${path.basename(hostDir)}`
    const configuredTarget =
        options.sherpaModelTargetDir || options.sherpaConfig?.modelDir

    if (selectedDevice.platform === 'ios') {
        if (selectedDevice.targetType !== 'physical') {
            throw new Error(
                '--stage-sherpa-model-host-dir for iOS currently requires a physical device'
            )
        }
        const relativeTarget = normalizeIOSDocumentsRelativePath(
            configuredTarget,
            fallbackRelativeTarget
        )
        const deviceIdentifier = findIOSPhysicalDeviceIdentifier(selectedDevice)
        const output = run('xcrun', [
            'devicectl',
            'device',
            'copy',
            'to',
            '--device',
            deviceIdentifier,
            '--domain-type',
            'appDataContainer',
            '--domain-identifier',
            PACKAGE_NAME,
            '--source',
            hostDir,
            '--destination',
            `Documents/${relativeTarget}`,
            '--remove-existing-content',
            'false',
        ])
        const targetDir =
            output.match(/^Path: (.+)$/m)?.[1]?.trim() ||
            output.match(/Path:\s+(.+)$/m)?.[1]?.trim()
        if (!targetDir) {
            throw new Error(
                `Failed to stage iOS Sherpa model to Documents/${relativeTarget}; devicectl output: ${output}`
            )
        }
        if (options.sherpaConfig) {
            options.sherpaConfig = {
                ...options.sherpaConfig,
                modelDir: targetDir,
            }
        }
        return {
            sourceHostDir: hostDir,
            targetDir,
            iosDeviceIdentifier: deviceIdentifier,
        }
    }

    if (selectedDevice.platform === 'android') {
        const targetDir = configuredTarget
        if (!targetDir) {
            throw new Error(
                '--stage-sherpa-model-host-dir on Android requires --stage-sherpa-model-to or sherpa-config.modelDir'
            )
        }
        const targetPath = toRunAsPath(PACKAGE_NAME, targetDir)
        const adbPrefix = SERIAL ? `adb -s ${shellQuote(SERIAL)}` : 'adb'
        run('bash', [
            '-lc',
            `tar -C ${shellQuote(hostDir)} -cf - . | ${adbPrefix} shell ${shellQuote(
                `run-as ${PACKAGE_NAME} sh -c ${shellQuote(
                    `rm -rf ${shellQuote(targetPath)} && mkdir -p ${shellQuote(
                        targetPath
                    )} && cd ${shellQuote(targetPath)} && tar -xf -`
                )}`
            )}`,
        ])
        return {
            sourceHostDir: hostDir,
            targetDir,
        }
    }

    throw new Error(
        `Unsupported platform for host Sherpa model staging: ${selectedDevice.platform}`
    )
}

function readMemory() {
    if (TARGET_PLATFORM !== 'android') {
        return {
            platform: TARGET_PLATFORM,
            unsupported: 'memory sampling is currently Android/ADB-only',
        }
    }
    try {
        const output = adb(['shell', `dumpsys meminfo ${PACKAGE_NAME}`])
        const totalPss = output.match(/^\s*TOTAL\s+(\d+)/m)?.[1]
        const nativeHeap = output.match(/^\s*Native Heap\s+(\d+)/m)?.[1]
        const javaHeap = output.match(/^\s*Java Heap\s+(\d+)/m)?.[1]
        const swapPss = output.match(/^\s*TOTAL SWAP PSS\s+(\d+)/m)?.[1]
        return {
            totalPssKb: totalPss ? Number(totalPss) : undefined,
            nativeHeapKb: nativeHeap ? Number(nativeHeap) : undefined,
            javaHeapKb: javaHeap ? Number(javaHeap) : undefined,
            swapPssKb: swapPss ? Number(swapPss) : undefined,
        }
    } catch (error) {
        return { error: String(error) }
    }
}

function readAppProcess() {
    if (TARGET_PLATFORM !== 'android') {
        return {
            alive: true,
            platform: TARGET_PLATFORM,
            unsupported: 'process sampling is currently Android/ADB-only',
        }
    }
    try {
        const output = adb([
            'shell',
            `pidof ${PACKAGE_NAME} 2>/dev/null || true`,
        ]).trim()
        return {
            alive: output.length > 0,
            pid: output || undefined,
        }
    } catch (error) {
        return { alive: false, error: String(error) }
    }
}

function checkMemoryBudget(options, memory) {
    const exceeded =
        (options.maxPssKb !== undefined &&
            memory.totalPssKb !== undefined &&
            memory.totalPssKb > options.maxPssKb) ||
        (options.maxNativeHeapKb !== undefined &&
            memory.nativeHeapKb !== undefined &&
            memory.nativeHeapKb > options.maxNativeHeapKb)
    if (!exceeded) return null
    return `memory-budget-exceeded: totalPssKb=${memory.totalPssKb ?? 'unknown'} maxPssKb=${
        options.maxPssKb ?? 'unset'
    } nativeHeapKb=${memory.nativeHeapKb ?? 'unknown'} maxNativeHeapKb=${
        options.maxNativeHeapKb ?? 'unset'
    }`
}

function progressKey(progress) {
    if (!progress) return ''
    return [
        progress.status,
        progress.chunkCount,
        progress.processedAudioMs,
        progress.transcriptEventCount,
        progress.transcriptCharCount,
    ].join(':')
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForCompletion(options) {
    const startedAt = Date.now()
    let lastProgressKey = ''
    let lastProgressAt = startedAt
    let lastHeartbeatAt = 0
    let firstBridgeErrorAt = 0
    let lastProgress = null
    while (Date.now() - startedAt < TIMEOUT_MS) {
        let progress
        let result
        try {
            progress = bridge([
                'eval',
                'globalThis.__AGENTIC__?.getLongAudioValidationProgress?.()',
            ])
            result = bridge([
                'eval',
                'globalThis.__AGENTIC__?.getLastResult?.()',
            ])
            firstBridgeErrorAt = 0
        } catch (error) {
            const memory = readMemory()
            const appProcess = readAppProcess()
            if (firstBridgeErrorAt === 0) firstBridgeErrorAt = Date.now()
            emit('bridge-error', {
                error: error instanceof Error ? error.message : String(error),
                elapsedWallMs: Date.now() - startedAt,
                bridgeGraceMs: BRIDGE_GRACE_MS,
                progress: lastProgress,
                memory,
                process: appProcess,
            })
            if (!appProcess.alive) {
                throw new Error(
                    `app-process-not-running while waiting for ${options.mode}`
                )
            }
            if (Date.now() - firstBridgeErrorAt > BRIDGE_GRACE_MS) {
                throw new Error(
                    `cdp-bridge-unavailable for ${Date.now() - firstBridgeErrorAt}ms while app process is alive`
                )
            }
            await sleep(POLL_INTERVAL_MS)
            continue
        }

        if (progress) {
            lastProgress = progress
        }
        const currentProgressKey = progressKey(progress)
        if (progress && currentProgressKey !== lastProgressKey) {
            lastProgressKey = currentProgressKey
            lastProgressAt = Date.now()
            const memory = readMemory()
            emit('progress', { progress, memory })
            const reason = checkMemoryBudget(options, memory)
            if (reason) {
                bridge([
                    'eval',
                    `globalThis.__AGENTIC__?.cancelLongAudioValidation?.(${JSON.stringify(reason)})`,
                ])
                emit('budget-exceeded', {
                    reason,
                    progress,
                    memory,
                    process: readAppProcess(),
                })
                throw new Error(reason)
            }
        }
        if (Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
            lastHeartbeatAt = Date.now()
            const memory = readMemory()
            const appProcess = readAppProcess()
            emit('heartbeat', {
                elapsedWallMs: Date.now() - startedAt,
                progress,
                memory,
                process: appProcess,
            })
            const reason = checkMemoryBudget(options, memory)
            if (reason) {
                bridge([
                    'eval',
                    `globalThis.__AGENTIC__?.cancelLongAudioValidation?.(${JSON.stringify(reason)})`,
                ])
                emit('budget-exceeded', {
                    reason,
                    progress,
                    memory,
                    process: appProcess,
                })
                throw new Error(reason)
            }
        }
        if (
            result?.op === 'validateLongAudioStream' &&
            result.status !== 'pending'
        ) {
            emit('final', { result, memory: readMemory() })
            if (result.status === 'cancelled' && options.cancelAfterChunks) {
                emit('cancelled-ok', { result })
                return result
            }
            if (result.status !== 'success') {
                throw new Error(result.error || 'long-audio validation failed')
            }
            return result
        }
        if (Date.now() - lastProgressAt > options.stallTimeoutMs) {
            const reason = `progress-stalled: no new chunk progress for ${options.stallTimeoutMs}ms`
            bridge([
                'eval',
                `globalThis.__AGENTIC__?.cancelLongAudioValidation?.(${JSON.stringify(reason)})`,
            ])
            emit('progress-stalled', {
                reason,
                progress,
                memory: readMemory(),
                process: readAppProcess(),
            })
            throw new Error(reason)
        }
        await sleep(POLL_INTERVAL_MS)
    }
    throw new Error(`validateLongAudioStream timed out after ${TIMEOUT_MS}ms`)
}

async function main() {
    const options = parseArgs(process.argv.slice(2))
    TARGET_DEVICE = options.device || TARGET_DEVICE
    TARGET_PLATFORM = options.platform || TARGET_PLATFORM
    if (options.sherpaModelTargetDir && options.sherpaConfig) {
        options.sherpaConfig = {
            ...options.sherpaConfig,
            modelDir: options.sherpaModelTargetDir,
        }
    }
    const fixture = resolveFixture(options.fixture)

    emit('start', {
        mode: options.mode,
        fixture,
        packageName: PACKAGE_NAME,
        device: TARGET_DEVICE || '(auto)',
        platform: TARGET_PLATFORM,
        serial: SERIAL || '(auto)',
        startTimeMs: options.startTimeMs,
        endTimeMs: options.endTimeMs,
    })

    const previousTargetDevice = TARGET_DEVICE
    TARGET_DEVICE = ''
    const devices = bridge(['list-devices'])
    emit('devices', devices)
    TARGET_DEVICE = previousTargetDevice
    const selectedDevice = selectTargetDevice(devices, options)
    emit('target-device', selectedDevice)

    const staged = stageFixtureForTarget(fixture, selectedDevice)
    emit('fixture-staged', staged)

    const stagedSherpaHostModel = stageSherpaHostModel(options, selectedDevice)
    if (stagedSherpaHostModel) {
        emit('sherpa-host-model-staged', stagedSherpaHostModel)
    }

    const stagedSherpaModel = stageSherpaModelFromPackage(options)
    if (stagedSherpaModel) {
        emit('sherpa-model-staged', stagedSherpaModel)
    }

    const appOptions = {
        fileUri: staged.devicePath,
        mode: options.mode,
        modelId: options.mode === 'moonshine' ? options.modelId : undefined,
        startTimeMs: options.startTimeMs,
        endTimeMs: options.endTimeMs,
        sherpaAsrConfig:
            options.mode === 'sherpa-online' ||
            options.mode === 'sherpa-offline-segments'
                ? options.sherpaConfig
                : undefined,
        sherpaSegmentDurationMs:
            options.mode === 'sherpa-offline-segments'
                ? options.sherpaSegmentDurationMs
                : undefined,
        sherpaReleaseBetweenSegments:
            options.mode === 'sherpa-offline-segments'
                ? options.sherpaReleaseBetweenSegments
                : undefined,
        moonshineFeedMode:
            options.mode === 'moonshine'
                ? options.moonshineFeedMode
                : undefined,
        chunkDurationMs: options.chunkDurationMs,
        maxBufferedChunks: options.maxBufferedChunks,
        progressEveryChunks: options.progressEveryChunks,
        cancelAfterChunks: options.cancelAfterChunks,
    }

    bridge([
        'eval',
        `globalThis.__AGENTIC__?.validateLongAudioStream?.(${JSON.stringify(appOptions)})`,
    ])
    await waitForCompletion(options)
}

main().catch((error) => {
    emit('error', {
        error: error instanceof Error ? error.message : String(error),
    })
    process.exitCode = 1
})
