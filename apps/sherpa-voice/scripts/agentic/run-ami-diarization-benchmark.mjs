#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadOfficialAmiReference } from '../../../../scripts/diarization-benchmark/ami-reference.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..')
const BENCHMARK_MANIFEST = JSON.parse(
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
const BRIDGE = path.join(APP_ROOT, 'scripts', 'agentic', 'cdp-bridge.mjs')
const JS_SCORER = path.join(APP_ROOT, 'scripts', 'diarization-score.mjs')
const PYANNOTE_SCORER = path.join(
    APP_ROOT,
    'scripts',
    'diarization-score-pyannote.py'
)
const REPORT_ROOT = path.join(
    APP_ROOT,
    '.agent',
    'validation-logs',
    'diarization',
    'ami-benchmark'
)

const SERIAL = process.env.ANDROID_SERIAL || process.env.ADB_SERIAL || ''
const DEVICE = process.env.BENCHMARK_DEVICE || process.env.AGENTIC_DEVICE || ''
const PACKAGE =
    process.env.ANDROID_PACKAGE || 'net.siteed.sherpavoice.development'
const AUDIO_ROOT =
    process.env.AMI_AUDIO_ROOT || '/Volumes/c910ssd/datasets/amicorpus'
const RTTM_ROOT = process.env.AMI_RTTM_ROOT || ''
const WINDOWS_FILE = process.env.AMI_WINDOWS_FILE || ''
const BENCHMARK_SUITE = process.env.BENCHMARK_SUITE || 'stress'
const PYANNOTE_PYTHON = process.env.PYANNOTE_PYTHON || ''
const PROFILE = process.env.BENCHMARK_PROFILE || 'full'
const SHERPA_MANIFEST = BENCHMARK_MANIFEST.systems.sherpaOnnx
const AUTO_THRESHOLDS = (
    process.env.SHERPA_AUTO_THRESHOLDS ||
    SHERPA_MANIFEST.automaticThresholds.join(',')
)
    .split(',')
    .map(Number)
const POLL_MS = Number(process.env.BENCHMARK_POLL_MS || 500)
const TIMEOUT_MS = Number(process.env.BENCHMARK_TIMEOUT_MS || 10 * 60 * 1000)

const DEFAULT_WINDOWS = BENCHMARK_MANIFEST.dataset.liveStressWindows
const EMBEDDING_MODELS = SHERPA_MANIFEST.embeddings.map(({ id, label }) => ({
    id,
    label,
}))

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function run(
    command,
    args,
    { cwd = REPO_ROOT, parseJson = false, allowFailure = false } = {}
) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        env: process.env,
        maxBuffer: 50 * 1024 * 1024,
    })
    if (result.status !== 0 && !allowFailure) {
        const output = [result.stdout, result.stderr]
            .filter(Boolean)
            .join('\n')
            .trim()
        throw new Error(output || `${command} ${args.join(' ')} failed`)
    }
    const stdout = String(result.stdout || '').trim()
    return parseJson && stdout ? JSON.parse(stdout) : stdout
}

function adb(args, options) {
    return run('adb', SERIAL ? ['-s', SERIAL, ...args] : args, options)
}

function bridge(args) {
    return run(
        'node',
        DEVICE ? [BRIDGE, '--device', DEVICE, ...args] : [BRIDGE, ...args],
        { parseJson: true }
    )
}

function loadWindows() {
    if (!WINDOWS_FILE) {
        if (BENCHMARK_SUITE === 'stress') return DEFAULT_WINDOWS
        if (BENCHMARK_SUITE === 'parity') {
            const meeting = BENCHMARK_MANIFEST.dataset.parityMeeting
            return [
                {
                    meetingId: meeting.id,
                    startS: 0,
                    endS: meeting.durationSeconds,
                },
            ]
        }
        throw new Error('BENCHMARK_SUITE must be stress or parity')
    }
    const parsed = JSON.parse(fs.readFileSync(WINDOWS_FILE, 'utf8'))
    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('AMI_WINDOWS_FILE must contain a non-empty JSON array')
    }
    return parsed
}

function validateWindow(raw) {
    const meetingId = String(raw.meetingId || '')
    const startS = Number(raw.startS)
    const endS = Number(raw.endS)
    if (
        !/^[A-Za-z0-9_-]+$/.test(meetingId) ||
        !Number.isFinite(startS) ||
        !Number.isFinite(endS)
    ) {
        throw new Error(`Invalid window: ${JSON.stringify(raw)}`)
    }
    if (startS < 0 || endS <= startS) {
        throw new Error(`Invalid window bounds: ${JSON.stringify(raw)}`)
    }
    return { meetingId, startS, endS }
}

function getClip(window) {
    const id = `${window.meetingId}-${window.startS}-${window.endS}`
    return {
        ...window,
        id,
        durationS: window.endS - window.startS,
        sourceAudio: path.join(
            AUDIO_ROOT,
            window.meetingId,
            'audio',
            `${window.meetingId}.Mix-Headset.wav`
        ),
        hostClip: path.join(REPORT_ROOT, 'clips', `${id}.wav`),
        deviceClip: `/data/user/0/${PACKAGE}/files/validation/ami/${id}.wav`,
    }
}

function prepareHostClip(clip) {
    if (!fs.existsSync(clip.sourceAudio)) {
        throw new Error(`Missing AMI audio: ${clip.sourceAudio}`)
    }
    fs.mkdirSync(path.dirname(clip.hostClip), { recursive: true })
    run('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-ss',
        String(clip.startS),
        '-t',
        String(clip.durationS),
        '-i',
        clip.sourceAudio,
        '-ac',
        '1',
        '-ar',
        '16000',
        clip.hostClip,
    ])
    if (
        !fs.existsSync(clip.hostClip) ||
        fs.statSync(clip.hostClip).size === 0
    ) {
        throw new Error(`Failed to create ${clip.hostClip}`)
    }
}

function stageClip(clip) {
    const temporaryPath = `/data/local/tmp/${path.basename(clip.hostClip)}`
    adb(['push', clip.hostClip, temporaryPath])
    adb(['shell', 'run-as', PACKAGE, 'mkdir', '-p', 'files/validation/ami'])
    adb(['shell', 'run-as', PACKAGE, 'cp', temporaryPath, clip.deviceClip])
    const size = Number(
        adb(['shell', 'run-as', PACKAGE, 'stat', '-c', '%s', clip.deviceClip])
    )
    if (!Number.isFinite(size) || size <= 0) {
        throw new Error(`Failed to stage ${clip.deviceClip}`)
    }
}

function buildCases(referenceSpeakerCount) {
    const fixed = EMBEDDING_MODELS.map((model) => ({
        label: `fixed${referenceSpeakerCount}-${model.id}`,
        embeddingModelId: model.id,
        segmentationModelFile: SHERPA_MANIFEST.segmentation.file,
        numClusters: referenceSpeakerCount,
        threshold: 0.5,
        numThreads: SHERPA_MANIFEST.numThreads,
    }))
    if (
        AUTO_THRESHOLDS.length === 0 ||
        AUTO_THRESHOLDS.some((threshold) => !Number.isFinite(threshold))
    ) {
        throw new Error(
            'SHERPA_AUTO_THRESHOLDS must be comma-separated numbers'
        )
    }
    const automatic = AUTO_THRESHOLDS.map((threshold) => ({
        label: `auto-eres2net-t${threshold}`,
        embeddingModelId: SHERPA_MANIFEST.automaticEmbeddingId,
        segmentationModelFile: SHERPA_MANIFEST.segmentation.file,
        numClusters: -1,
        threshold,
        numThreads: SHERPA_MANIFEST.numThreads,
    }))
    const fixedById = new Map(
        fixed.map((benchmarkCase) => [
            benchmarkCase.embeddingModelId,
            benchmarkCase,
        ])
    )
    const oracle = fixedById.get(SHERPA_MANIFEST.oracleEmbeddingId)
    if (!oracle) {
        throw new Error('Sherpa oracle embedding is missing from the manifest')
    }
    if (PROFILE === 'finalists') {
        const autoDefault = automatic.find((row) => row.threshold === 0.5)
        return [
            ...SHERPA_MANIFEST.finalistEmbeddingIds.map((id) => {
                const benchmarkCase = fixedById.get(id)
                if (!benchmarkCase) {
                    throw new Error(
                        `Sherpa finalist ${id} is missing from the manifest`
                    )
                }
                return benchmarkCase
            }),
            autoDefault || automatic[0],
        ]
    }
    if (PROFILE === 'primary') {
        const autoDefault = automatic.find((row) => row.threshold === 0.5)
        return [oracle, autoDefault || automatic[0]]
    }
    if (PROFILE === 'oracle') return [oracle]
    if (PROFILE === 'auto') return automatic
    if (PROFILE !== 'full') {
        throw new Error(`Unknown BENCHMARK_PROFILE: ${PROFILE}`)
    }
    return [...fixed, ...automatic]
}

function readPssKb() {
    const output = adb(['shell', 'dumpsys', 'meminfo', PACKAGE], {
        allowFailure: true,
    })
    const match = output.match(/TOTAL PSS:\s*(\d+)/)
    return match ? Number(match[1]) : null
}

async function runCase(filePath, benchmarkCase) {
    const expression =
        `globalThis.__AGENTIC__.benchmarkNativeDiarizationFile(` +
        `${JSON.stringify(filePath)},${JSON.stringify(benchmarkCase)})`
    bridge(['eval', expression])
    const baselinePssKb = readPssKb()
    let peakPssKb = baselinePssKb
    const startedAt = Date.now()

    while (Date.now() - startedAt < TIMEOUT_MS) {
        await sleep(POLL_MS)
        const pssKb = readPssKb()
        if (pssKb != null && (peakPssKb == null || pssKb > peakPssKb)) {
            peakPssKb = pssKb
        }
        const last = bridge(['eval', 'globalThis.__AGENTIC__.getLastResult()'])
        if (
            last?.op !== 'benchmarkNativeDiarizationFile' ||
            last?.status === 'pending'
        ) {
            continue
        }
        if (last.status !== 'success') {
            throw new Error(last.error || `${benchmarkCase.label} failed`)
        }
        return {
            case: benchmarkCase,
            status: 'success',
            result: last.result,
            memory: {
                baselinePssKb,
                peakPssKb,
                afterPssKb: readPssKb(),
            },
        }
    }
    throw new Error(`${benchmarkCase.label} timed out after ${TIMEOUT_MS}ms`)
}

function runScorers(referencePath, hypothesisPath, outputStem) {
    const jsPath = `${outputStem}-frame-score.json`
    run('node', [
        JS_SCORER,
        '--reference',
        referencePath,
        '--hypothesis',
        hypothesisPath,
        '--out',
        jsPath,
    ])

    let strictPath = null
    let standardPath = null
    if (PYANNOTE_PYTHON) {
        strictPath = `${outputStem}-pyannote-strict-score.json`
        run(PYANNOTE_PYTHON, [
            PYANNOTE_SCORER,
            '--reference',
            referencePath,
            '--hypothesis',
            hypothesisPath,
            '--out',
            strictPath,
            '--uem',
            'full',
        ])
        standardPath = `${outputStem}-pyannote-standard-score.json`
        run(PYANNOTE_PYTHON, [
            PYANNOTE_SCORER,
            '--reference',
            referencePath,
            '--hypothesis',
            hypothesisPath,
            '--out',
            standardPath,
            '--uem',
            'full',
            '--collar',
            '0.25',
            '--skip-overlap',
        ])
    }
    return {
        frame: JSON.parse(fs.readFileSync(jsPath, 'utf8')),
        strict: strictPath
            ? JSON.parse(fs.readFileSync(strictPath, 'utf8'))
            : null,
        standard: standardPath
            ? JSON.parse(fs.readFileSync(standardPath, 'utf8'))
            : null,
        paths: { frame: jsPath, strict: strictPath, standard: standardPath },
    }
}

function getScoreMap(scores) {
    const frame = new Map(
        (scores.frame?.results || []).map((row) => [row.label, row.score])
    )
    const strict = new Map(
        (scores.strict?.results || []).map((row) => [row.label, row.score])
    )
    const standard = new Map(
        (scores.standard?.results || []).map((row) => [row.label, row.score])
    )
    return new Map(
        [...frame.keys()].map((label) => [
            label,
            {
                strictDerPercent:
                    strict.get(label)?.diarizationErrorRatePercent ??
                    frame.get(label)?.derPercent,
                strictJerPercent:
                    strict.get(label)?.jaccardErrorRatePercent ?? null,
                standardDerPercent:
                    standard.get(label)?.diarizationErrorRatePercent ?? null,
                standardJerPercent:
                    standard.get(label)?.jaccardErrorRatePercent ?? null,
            },
        ])
    )
}

function formatScore(value) {
    return value == null ? 'n/a' : `${value.toFixed(2)}%`
}

function renderResultRow(row) {
    const automatic = row.case.numClusters <= 0
    const mode = automatic ? `auto ${row.case.threshold}` : 'known count'
    const requested = automatic ? 'auto' : row.case.numClusters
    const cells = [
        mode,
        row.case.embeddingModelId,
        requested,
        row.result.numSpeakers,
        formatScore(row.score.standardDerPercent),
        formatScore(row.score.standardJerPercent),
        formatScore(row.score.strictDerPercent),
        formatScore(row.score.strictJerPercent),
    ]
    return `| ${cells.join(' | ')} |`
}

function renderClipMarkdown(clip) {
    const rows = clip.rows.map(renderResultRow)
    const failures = (clip.errors || []).flatMap((failure) => [
        `Failed case \`${failure.case.label}\`: ${failure.error}`,
        '',
    ])
    return [
        `## ${clip.id}`,
        '',
        `Reference: ${clip.reference.speakerCount} speakers, ${clip.reference.segmentCount} official AMI speech segments.`,
        '',
        '| Mode | Embedding | Requested | Detected | Standard DER | Standard JER | Strict DER | Strict JER |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...rows,
        '',
        ...failures,
    ]
}

function renderMarkdown(report) {
    const lines = [
        '# AMI on-device diarization benchmark',
        '',
        `Run: \`${report.createdAt}\``,
        `Device: \`${report.device.model}\` on Android \`${report.device.androidRelease}\``,
        `Runtime: \`@siteed/sherpa-onnx.rn\` at \`${report.gitCommit}\``,
        `Scoring: \`${report.scoring}\``,
        '',
    ]

    for (const clip of report.clips) {
        lines.push(...renderClipMarkdown(clip))
    }
    return `${lines.join('\n')}\n`
}

function getDeviceMetadata() {
    return {
        serial: SERIAL || adb(['get-serialno']),
        model: adb(['shell', 'getprop', 'ro.product.model']),
        hardware: adb(['shell', 'getprop', 'ro.product.device']),
        androidRelease: adb(['shell', 'getprop', 'ro.build.version.release']),
        sdk: adb(['shell', 'getprop', 'ro.build.version.sdk']),
        abi: adb(['shell', 'getprop', 'ro.product.cpu.abi']),
    }
}

async function main() {
    fs.mkdirSync(REPORT_ROOT, { recursive: true })
    const devices = bridge(['list-devices'])
    if ((devices?.count || 0) !== 1) {
        throw new Error(
            `Expected one Sherpa Voice target, found ${devices?.count || 0}`
        )
    }
    const state = bridge(['eval', 'globalThis.__AGENTIC__.getState()'])
    const requiredModels = [
        'pyannote-segmentation-3-0',
        ...EMBEDDING_MODELS.map((model) => model.id),
    ]
    const missingModels = requiredModels.filter(
        (id) => state?.models?.statuses?.[id]?.status !== 'downloaded'
    )
    if (missingModels.length > 0) {
        throw new Error(
            `Download these models in Sherpa Voice first: ${missingModels.join(', ')}`
        )
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const runDir = path.join(REPORT_ROOT, stamp)
    fs.mkdirSync(runDir, { recursive: true })
    const clips = []

    for (const rawWindow of loadWindows()) {
        const clip = getClip(validateWindow(rawWindow))
        prepareHostClip(clip)
        stageClip(clip)
        const officialReference = loadOfficialAmiReference({
            meetingId: clip.meetingId,
            startS: clip.startS,
            endS: clip.endS,
            cacheDir: path.join(REPORT_ROOT, 'references'),
            rttmRoot: RTTM_ROOT,
        })
        const referenceSegments = officialReference.segments
        const referenceSpeakers = [
            ...new Set(referenceSegments.map((row) => row.speaker)),
        ]
        const referencePath = path.join(runDir, `${clip.id}-reference.json`)
        fs.writeFileSync(
            referencePath,
            `${JSON.stringify({ segments: referenceSegments }, null, 2)}\n`
        )

        const results = []
        const errors = []
        for (const benchmarkCase of buildCases(referenceSpeakers.length)) {
            process.stderr.write(`Running ${clip.id} ${benchmarkCase.label}\n`)
            try {
                results.push(await runCase(clip.deviceClip, benchmarkCase))
            } catch (error) {
                errors.push({
                    case: benchmarkCase,
                    status: 'error',
                    error:
                        error instanceof Error ? error.message : String(error),
                })
                break
            } finally {
                fs.writeFileSync(
                    path.join(runDir, `${clip.id}-checkpoint.json`),
                    `${JSON.stringify({ results, errors }, null, 2)}\n`
                )
            }
        }
        if (results.length === 0) {
            throw new Error(
                errors[0]?.error || `${clip.id} produced no results`
            )
        }
        const hypothesisPath = path.join(runDir, `${clip.id}-sherpa.json`)
        fs.writeFileSync(
            hypothesisPath,
            `${JSON.stringify({ result: { results } }, null, 2)}\n`
        )
        const scoreStem = path.join(runDir, clip.id)
        const scores = runScorers(referencePath, hypothesisPath, scoreStem)
        const scoreMap = getScoreMap(scores)

        clips.push({
            id: clip.id,
            meetingId: clip.meetingId,
            startS: clip.startS,
            endS: clip.endS,
            durationS: clip.durationS,
            sourceAudio: clip.sourceAudio,
            deviceClip: clip.deviceClip,
            reference: {
                speakerCount: referenceSpeakers.length,
                speakers: referenceSpeakers,
                segmentCount: referenceSegments.length,
                path: referencePath,
                source: officialReference.source,
                sourceUrl: officialReference.sourceUrl,
                setup: officialReference.setup,
                setupCommit: officialReference.setupCommit,
            },
            rows: results.map((row) => ({
                ...row,
                score: scoreMap.get(row.result.label),
            })),
            scorePaths: scores.paths,
            errors,
        })
    }

    const report = {
        schemaVersion: 1,
        benchmarkVersion: BENCHMARK_MANIFEST.benchmarkVersion,
        createdAt: new Date().toISOString(),
        complete: clips.every((clip) => clip.errors.length === 0),
        gitCommit: run('git', ['rev-parse', 'HEAD']),
        device: getDeviceMetadata(),
        appPackage: PACKAGE,
        profile: PROFILE,
        suite: BENCHMARK_SUITE,
        audioRoot: AUDIO_ROOT,
        rttmRoot: RTTM_ROOT || null,
        segmentationModel: {
            ...SHERPA_MANIFEST.segmentation,
        },
        embeddingModels: SHERPA_MANIFEST.embeddings,
        scoring: PYANNOTE_PYTHON
            ? 'pyannote.metrics 4.x; standard: 0.25 s collar and overlap excluded; strict: 0 collar and overlap included; full clip UEM'
            : '20 ms frame scorer, collar 0, overlap included',
        clips,
    }
    const jsonPath = path.join(runDir, 'report.json')
    const markdownPath = path.join(runDir, 'report.md')
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
    fs.writeFileSync(markdownPath, renderMarkdown(report))
    console.log(
        JSON.stringify({ json: jsonPath, markdown: markdownPath }, null, 2)
    )
    if (!report.complete) process.exitCode = 1
}

await main()
