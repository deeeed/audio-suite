#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { acquireBenchmarkHostLock } from './host-lock.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const MANIFEST_PATH = path.join(
    REPO_ROOT,
    'benchmarks',
    'on-device-diarization',
    'manifest.json'
)
const TEMPLATE_ROOT = path.join(SCRIPT_DIR, 'fluid-ios-simulator')
const AGENT_ROOT = path.join(REPO_ROOT, '.agent', 'diarization-benchmark')
const WORK_ROOT = path.join(AGENT_ROOT, 'fluid-ios-simulator-work')
const REPORT_ROOT = path.join(AGENT_ROOT, 'reports')
const SCORER = path.join(SCRIPT_DIR, 'score-report.mjs')

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd || REPO_ROOT,
        encoding: 'utf8',
        env: process.env,
        maxBuffer: options.maxBuffer || 20 * 1024 * 1024,
        stdio: options.stdio,
    })
    if (result.status !== 0) {
        throw new Error(
            [result.stdout, result.stderr].filter(Boolean).join('\n') ||
                `${command} ${args.join(' ')} failed with ${result.status}`
        )
    }
    return String(result.stdout || '').trim()
}

function sha256(filePath) {
    const hash = crypto.createHash('sha256')
    hash.update(fs.readFileSync(filePath))
    return hash.digest('hex')
}

function getSimulator(name) {
    const value = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', '-j']))
    const candidates = Object.entries(value.devices || {}).flatMap(
        ([runtime, devices]) =>
            devices
                .filter((device) => device.isAvailable && device.name === name)
                .map((device) => ({ ...device, runtime }))
    )
    if (candidates.length !== 1) {
        throw new Error(
            `Expected one available simulator named ${name}, found ${candidates.length}`
        )
    }
    return candidates[0]
}

function getFluidModelRevision(repository) {
    const response = run('curl', [
        '-fsSL',
        `https://huggingface.co/api/models/${repository}`,
    ])
    return JSON.parse(response).sha
}

function preparePackage(manifest, audioPath) {
    fs.mkdirSync(WORK_ROOT, { recursive: true })
    fs.cpSync(
        path.join(TEMPLATE_ROOT, 'Sources'),
        path.join(WORK_ROOT, 'Sources'),
        {
            recursive: true,
        }
    )
    fs.cpSync(
        path.join(TEMPLATE_ROOT, 'Tests'),
        path.join(WORK_ROOT, 'Tests'),
        {
            recursive: true,
        }
    )
    const packageTemplate = fs.readFileSync(
        path.join(TEMPLATE_ROOT, 'Package.swift.template'),
        'utf8'
    )
    fs.writeFileSync(
        path.join(WORK_ROOT, 'Package.swift'),
        packageTemplate.replace(
            '__FLUID_AUDIO_VERSION__',
            manifest.systems.fluidAudio.version
        )
    )
    const testPath = path.join(
        WORK_ROOT,
        'Tests',
        'FluidIOSBenchmarkTests',
        'FluidIOSBenchmarkTests.swift'
    )
    fs.writeFileSync(
        testPath,
        fs
            .readFileSync(testPath, 'utf8')
            .replaceAll(
                '__FLUID_AUDIO_VERSION__',
                manifest.systems.fluidAudio.version
            )
            .replaceAll(
                '__MODEL_REVISION__',
                manifest.systems.fluidAudio.modelRevision
            )
            .replaceAll(
                '__CLUSTERING_THRESHOLD__',
                String(manifest.systems.fluidAudio.config.threshold)
            )
            .replaceAll(
                '__SEGMENTATION_STEP_RATIO__',
                String(manifest.systems.fluidAudio.config.stepRatio)
            )
            .replaceAll(
                '__MIN_SEGMENT_DURATION__',
                String(
                    manifest.systems.fluidAudio.config.minSegmentDurationSeconds
                )
            )
    )
    const fixtures = path.join(
        WORK_ROOT,
        'Tests',
        'FluidIOSBenchmarkTests',
        'Fixtures'
    )
    fs.mkdirSync(fixtures, { recursive: true })
    fs.copyFileSync(audioPath, path.join(fixtures, 'parity-meeting.wav'))
    run('swift', ['package', 'resolve', '--package-path', WORK_ROOT])
    const resolved = JSON.parse(
        fs.readFileSync(path.join(WORK_ROOT, 'Package.resolved'), 'utf8')
    )
    const fluidPin = resolved.pins.find((pin) => pin.identity === 'fluidaudio')
    if (fluidPin?.state?.revision !== manifest.systems.fluidAudio.commit) {
        throw new Error(
            `FluidAudio source is ${fluidPin?.state?.revision || 'missing'}, expected ${manifest.systems.fluidAudio.commit}`
        )
    }
}

function main() {
    const releaseHostLock = acquireBenchmarkHostLock(
        AGENT_ROOT,
        'fluid-ios-simulator'
    )
    try {
        const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
        const meeting = manifest.dataset.parityMeeting
        const audioRoot = process.env.AMI_AUDIO_ROOT
        if (!audioRoot) throw new Error('AMI_AUDIO_ROOT is required')
        const audioPath = path.join(
            audioRoot,
            meeting.id,
            'audio',
            `${meeting.id}.Mix-Headset.wav`
        )
        if (!fs.existsSync(audioPath))
            throw new Error(`Missing AMI audio: ${audioPath}`)
        const audioHash = sha256(audioPath)
        if (audioHash !== meeting.audioSha256) {
            throw new Error(
                `Audio checksum mismatch: expected ${meeting.audioSha256}, got ${audioHash}`
            )
        }

        const observedModelRevision = getFluidModelRevision(
            manifest.systems.fluidAudio.modelRepository
        )
        if (
            observedModelRevision !==
                manifest.systems.fluidAudio.modelRevision &&
            process.env.ALLOW_MODEL_REVISION_DRIFT !== '1'
        ) {
            throw new Error(
                `FluidAudio model revision changed from ${manifest.systems.fluidAudio.modelRevision} to ${observedModelRevision}. Review the model diff and update the manifest, or set ALLOW_MODEL_REVISION_DRIFT=1 for an exploratory run.`
            )
        }

        preparePackage(manifest, audioPath)
        fs.mkdirSync(REPORT_ROOT, { recursive: true })
        const simulatorName = process.env.IOS_SIMULATOR || 'audiolab-1'
        const simulator = getSimulator(simulatorName)
        const iterations = Number(process.env.BENCHMARK_ITERATIONS || 3)
        if (!Number.isInteger(iterations) || iterations < 1) {
            throw new Error('BENCHMARK_ITERATIONS must be a positive integer')
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const runDir = path.join(REPORT_ROOT, `fluid-ios-${timestamp}`)
        fs.mkdirSync(runDir, { recursive: true })
        const logPath = path.join(runDir, 'xcodebuild.log')
        const logFd = fs.openSync(logPath, 'w')
        const derivedData = path.join(AGENT_ROOT, 'fluid-ios-derived-data')
        const resultBundle = path.join(runDir, 'result.xcresult')
        const xcodeArgs = [
            '-scheme',
            'FluidIOSBenchmark',
            '-destination',
            `platform=iOS Simulator,id=${simulator.udid}`,
            '-only-testing:FluidIOSBenchmarkTests/FluidIOSBenchmarkTests/testParityMeeting',
            '-derivedDataPath',
            derivedData,
            '-resultBundlePath',
            resultBundle,
            '-test-iterations',
            String(iterations),
            'test',
        ]
        const result = spawnSync('xcodebuild', xcodeArgs, {
            cwd: WORK_ROOT,
            env: process.env,
            stdio: ['ignore', logFd, logFd],
        })
        fs.closeSync(logFd)
        if (result.status !== 0) {
            throw new Error(`iOS simulator benchmark failed. See ${logPath}`)
        }
        const log = fs.readFileSync(logPath, 'utf8')
        const matches = [
            ...log.matchAll(/IOS_BENCHMARK_JSON=([A-Za-z0-9+/=]+)/g),
        ]
        if (matches.length === 0) {
            throw new Error(`Benchmark JSON missing from ${logPath}`)
        }
        if (matches.length !== iterations) {
            throw new Error(
                `Expected ${iterations} benchmark results in ${logPath}, found ${matches.length}`
            )
        }
        const nativeResults = matches.map((match) =>
            JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
        )
        const canonicalSegments = JSON.stringify(nativeResults[0].segments)
        if (
            nativeResults.some(
                (nativeResult) =>
                    JSON.stringify(nativeResult.segments) !== canonicalSegments
            )
        ) {
            throw new Error(
                'FluidAudio simulator iterations produced different segments'
            )
        }
        const processSecondsByIteration = nativeResults.map(
            (nativeResult) => nativeResult.processSeconds
        )
        const sortedSeconds = [...processSecondsByIteration].sort(
            (a, b) => a - b
        )
        const processSeconds =
            sortedSeconds[Math.floor(sortedSeconds.length / 2)]
        const nativeResult = nativeResults[0]
        const report = {
            schemaVersion: 1,
            benchmarkVersion: manifest.benchmarkVersion,
            createdAt: new Date().toISOString(),
            gitCommit: run('git', ['rev-parse', 'HEAD']),
            runtimeVersion: manifest.systems.fluidAudio.version,
            modelRevisionOrHashes: {
                expected: manifest.systems.fluidAudio.modelRevision,
                observed: observedModelRevision,
            },
            hostHardware: {
                hostname: os.hostname(),
                model: run('sysctl', ['-n', 'hw.model']),
                architecture: os.arch(),
            },
            platform: {
                type: 'ios-simulator',
                name: simulator.name,
                udid: simulator.udid,
                runtime: simulator.runtime,
            },
            audioSha256: audioHash,
            speakerCountMode: 'automatic',
            detectedSpeakerCount: new Set(
                nativeResult.segments.map((segment) => segment.speaker)
            ).size,
            processSeconds,
            processSecondsByIteration,
            iterations,
            rtfx: meeting.durationSeconds / processSeconds,
            clips: [
                {
                    id: meeting.id,
                    meetingId: meeting.id,
                    startS: 0,
                    endS: meeting.durationSeconds,
                    reference: {},
                    rows: [
                        {
                            case: {
                                label: 'fluidaudio-offline-vbx-ios-simulator',
                                numClusters: -1,
                            },
                            result: {
                                label: 'fluidaudio-offline-vbx-ios-simulator',
                                numSpeakers: new Set(
                                    nativeResult.segments.map(
                                        (segment) => segment.speaker
                                    )
                                ).size,
                                segmentCount: nativeResult.segments.length,
                                durationMs: meeting.durationSeconds * 1000,
                                timing: { processMs: processSeconds * 1000 },
                                segments: nativeResult.segments,
                            },
                        },
                    ],
                },
            ],
        }
        const rawPath = path.join(runDir, 'report.json')
        fs.writeFileSync(rawPath, `${JSON.stringify(report, null, 2)}\n`)

        let scoredPath = null
        if (process.env.PYANNOTE_PYTHON) {
            scoredPath = path.join(runDir, 'report-scored.json')
            run(
                process.execPath,
                [
                    SCORER,
                    '--input',
                    rawPath,
                    '--out',
                    scoredPath,
                    '--python',
                    process.env.PYANNOTE_PYTHON,
                    ...(process.env.AMI_RTTM_ROOT
                        ? ['--rttm-root', process.env.AMI_RTTM_ROOT]
                        : []),
                ],
                { maxBuffer: 50 * 1024 * 1024 }
            )
        }
        console.log(
            JSON.stringify(
                {
                    raw: rawPath,
                    scored: scoredPath,
                    simulator: simulator.name,
                    processSeconds,
                    rtfx: report.rtfx,
                },
                null,
                2
            )
        )
    } finally {
        releaseHostLock()
    }
}

main()
