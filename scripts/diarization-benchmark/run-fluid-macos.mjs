#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { acquireBenchmarkHostLock } from './host-lock.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const MANIFEST = JSON.parse(
    fs.readFileSync(
        path.join(
            REPO_ROOT,
            'benchmarks',
            'on-device-diarization',
            'manifest.json'
        ),
        'utf8'
    )
)
const AGENT_ROOT = path.join(REPO_ROOT, '.agent', 'diarization-benchmark')
const SCORER = path.join(SCRIPT_DIR, 'score-report.mjs')
const TEMPLATE_ROOT = path.join(SCRIPT_DIR, 'fluid-macos-native')
const WORK_ROOT = path.join(AGENT_ROOT, 'fluid-macos-native-work')

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd || REPO_ROOT,
        encoding: 'utf8',
        env: process.env,
        maxBuffer: options.maxBuffer || 50 * 1024 * 1024,
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

function prepareNativeRunner() {
    fs.mkdirSync(WORK_ROOT, { recursive: true })
    fs.cpSync(
        path.join(TEMPLATE_ROOT, 'Sources'),
        path.join(WORK_ROOT, 'Sources'),
        { recursive: true }
    )
    const packageTemplate = fs.readFileSync(
        path.join(TEMPLATE_ROOT, 'Package.swift.template'),
        'utf8'
    )
    fs.writeFileSync(
        path.join(WORK_ROOT, 'Package.swift'),
        packageTemplate.replace(
            '__FLUID_AUDIO_VERSION__',
            MANIFEST.systems.fluidAudio.version
        )
    )
    run('swift', ['package', 'resolve', '--package-path', WORK_ROOT])
    const resolved = JSON.parse(
        fs.readFileSync(path.join(WORK_ROOT, 'Package.resolved'), 'utf8')
    )
    const fluidPin = resolved.pins.find((pin) => pin.identity === 'fluidaudio')
    if (fluidPin?.state?.revision !== MANIFEST.systems.fluidAudio.commit) {
        throw new Error(
            `FluidAudio source is ${fluidPin?.state?.revision || 'missing'}, expected ${MANIFEST.systems.fluidAudio.commit}`
        )
    }
    run('swift', [
        'build',
        '-c',
        'release',
        '--package-path',
        WORK_ROOT,
        '--product',
        'FluidMacOSBenchmark',
    ])
    return {
        binary: path.join(
            WORK_ROOT,
            '.build',
            'release',
            'FluidMacOSBenchmark'
        ),
        modelCache: path.join(
            AGENT_ROOT,
            'models',
            `fluid-${MANIFEST.systems.fluidAudio.version}-${MANIFEST.systems.fluidAudio.modelRevision}`
        ),
    }
}

function getModelRevision() {
    return JSON.parse(
        run('curl', [
            '-fsSL',
            `https://huggingface.co/api/models/${MANIFEST.systems.fluidAudio.modelRepository}`,
        ])
    ).sha
}

function summarize(scored) {
    const rows = scored.clips.map((clip) => ({
        meetingId: clip.meetingId,
        referenceSpeakers: clip.reference.speakerCount,
        detectedSpeakers: clip.rows[0].result.numSpeakers,
        processSeconds: clip.rows[0].result.timing.processMs / 1000,
        standardDerPercent:
            clip.rows[0].benchmarkScores.standard.diarizationErrorRatePercent,
        standardJerPercent:
            clip.rows[0].benchmarkScores.standard.jaccardErrorRatePercent,
        strictDerPercent:
            clip.rows[0].benchmarkScores.strict.diarizationErrorRatePercent,
        strictJerPercent:
            clip.rows[0].benchmarkScores.strict.jaccardErrorRatePercent,
    }))
    const average = (key) =>
        rows.reduce((sum, row) => sum + row[key], 0) / rows.length
    return {
        meetingCount: rows.length,
        exactSpeakerCountMeetings: rows.filter(
            (row) => row.referenceSpeakers === row.detectedSpeakers
        ).length,
        macroStandardDerPercent: average('standardDerPercent'),
        macroStandardJerPercent: average('standardJerPercent'),
        macroStrictDerPercent: average('strictDerPercent'),
        macroStrictJerPercent: average('strictJerPercent'),
        rows,
    }
}

function selectMeetings(scope) {
    if (scope === 'full') return MANIFEST.dataset.testMeetings
    if (scope === 'parity') return [MANIFEST.dataset.parityMeeting.id]
    throw new Error('BENCHMARK_SCOPE must be parity or full')
}

function main() {
    const releaseHostLock = acquireBenchmarkHostLock(AGENT_ROOT, 'fluid-macos')
    try {
        const audioRoot = process.env.AMI_AUDIO_ROOT
        const python = process.env.PYANNOTE_PYTHON
        if (!audioRoot) throw new Error('AMI_AUDIO_ROOT is required')
        if (!python) throw new Error('PYANNOTE_PYTHON is required')
        const scope = process.env.BENCHMARK_SCOPE || 'parity'
        const meetings = selectMeetings(scope)
        const iterations = Number(
            process.env.BENCHMARK_ITERATIONS || (scope === 'parity' ? 3 : 1)
        )
        if (!Number.isInteger(iterations) || iterations < 1) {
            throw new Error('BENCHMARK_ITERATIONS must be a positive integer')
        }
        const observedModelRevision = getModelRevision()
        if (
            observedModelRevision !==
                MANIFEST.systems.fluidAudio.modelRevision &&
            process.env.ALLOW_MODEL_REVISION_DRIFT !== '1'
        ) {
            throw new Error(
                `FluidAudio model revision changed from ${MANIFEST.systems.fluidAudio.modelRevision} to ${observedModelRevision}`
            )
        }
        const nativeRunner = prepareNativeRunner()
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const runDir = path.join(AGENT_ROOT, 'reports', `fluid-macos-${stamp}`)
        const rawDir = path.join(runDir, 'raw')
        const iterationDir = path.join(runDir, 'iterations')
        fs.mkdirSync(rawDir, { recursive: true })
        fs.mkdirSync(iterationDir, { recursive: true })
        for (const meetingId of meetings) {
            const audioPath = path.join(
                audioRoot,
                meetingId,
                'audio',
                `${meetingId}.Mix-Headset.wav`
            )
            if (!fs.existsSync(audioPath))
                throw new Error(`Missing ${audioPath}`)
            const results = []
            for (let iteration = 1; iteration <= iterations; iteration += 1) {
                const outputPath = path.join(
                    iterationDir,
                    `${meetingId}-${iteration}.json`
                )
                const logPath = path.join(
                    iterationDir,
                    `${meetingId}-${iteration}.log`
                )
                const logFd = fs.openSync(logPath, 'w')
                const result = spawnSync(
                    nativeRunner.binary,
                    [
                        audioPath,
                        outputPath,
                        nativeRunner.modelCache,
                        String(MANIFEST.systems.fluidAudio.config.threshold),
                        String(MANIFEST.systems.fluidAudio.config.stepRatio),
                        String(
                            MANIFEST.systems.fluidAudio.config
                                .minSegmentDurationSeconds
                        ),
                    ],
                    {
                        cwd: WORK_ROOT,
                        env: process.env,
                        stdio: ['ignore', logFd, logFd],
                    }
                )
                fs.closeSync(logFd)
                if (result.status !== 0) {
                    throw new Error(`${meetingId} failed. See ${logPath}`)
                }
                results.push(JSON.parse(fs.readFileSync(outputPath, 'utf8')))
            }
            const canonicalSegments = JSON.stringify(results[0].segments)
            if (
                results.some(
                    (result) =>
                        JSON.stringify(result.segments) !== canonicalSegments
                )
            ) {
                throw new Error(
                    `${meetingId} iterations produced different segments`
                )
            }
            const processSecondsByIteration = results.map(
                (result) => result.processingTimeSeconds
            )
            const timings = [...processSecondsByIteration].sort((a, b) => a - b)
            const canonical = results[0]
            canonical.processingTimeSeconds =
                timings[Math.floor(timings.length / 2)]
            canonical.realTimeFactor =
                canonical.durationSeconds / canonical.processingTimeSeconds
            canonical.processSecondsByIteration = processSecondsByIteration
            fs.writeFileSync(
                path.join(rawDir, `${meetingId}.json`),
                `${JSON.stringify(canonical, null, 2)}\n`
            )
        }
        const scoredPath = path.join(runDir, 'report-scored.json')
        run(process.execPath, [
            SCORER,
            '--input',
            rawDir,
            '--out',
            scoredPath,
            '--python',
            python,
            ...(process.env.AMI_RTTM_ROOT
                ? ['--rttm-root', process.env.AMI_RTTM_ROOT]
                : []),
        ])
        const scored = JSON.parse(fs.readFileSync(scoredPath, 'utf8'))
        const report = {
            schemaVersion: 1,
            benchmarkVersion: MANIFEST.benchmarkVersion,
            createdAt: new Date().toISOString(),
            gitCommit: run('git', ['rev-parse', 'HEAD']),
            runtimeVersion: MANIFEST.systems.fluidAudio.version,
            modelRevisionOrHashes: {
                expected: MANIFEST.systems.fluidAudio.modelRevision,
                observed: observedModelRevision,
            },
            hostHardware: {
                hostname: os.hostname(),
                model: run('sysctl', ['-n', 'hw.model']),
                architecture: os.arch(),
            },
            platform: 'macos-native',
            speakerCountMode: 'automatic',
            iterations,
            summary: summarize(scored),
            scoredReport: scoredPath,
        }
        const summaryPath = path.join(runDir, 'summary.json')
        fs.writeFileSync(summaryPath, `${JSON.stringify(report, null, 2)}\n`)
        console.log(
            JSON.stringify(
                { summary: summaryPath, scored: scoredPath },
                null,
                2
            )
        )
    } finally {
        releaseHostLock()
    }
}

main()
