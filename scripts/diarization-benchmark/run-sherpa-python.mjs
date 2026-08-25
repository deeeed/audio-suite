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
const SHERPA = MANIFEST.systems.sherpaOnnx
const AGENT_ROOT = path.join(REPO_ROOT, '.agent', 'diarization-benchmark')
const PYTHON_RUNNER = path.join(
    REPO_ROOT,
    'apps',
    'sherpa-voice',
    'scripts',
    'diarization-sherpa-python.py'
)
const SCORER = path.join(
    REPO_ROOT,
    'apps',
    'sherpa-voice',
    'scripts',
    'diarization-score-pyannote.py'
)

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd || REPO_ROOT,
        encoding: 'utf8',
        env: process.env,
        maxBuffer: options.maxBuffer || 50 * 1024 * 1024,
    })
    if (result.status !== 0) {
        throw new Error(
            [result.stdout, result.stderr].filter(Boolean).join('\n') ||
                `${command} failed with ${result.status}`
        )
    }
    return String(result.stdout || '').trim()
}

function sha256(filePath) {
    return crypto
        .createHash('sha256')
        .update(fs.readFileSync(filePath))
        .digest('hex')
}

function download(url, destination) {
    if (!fs.existsSync(destination)) {
        fs.mkdirSync(path.dirname(destination), { recursive: true })
        run('curl', ['-fsSL', url, '-o', destination])
    }
}

function verifyModel(model, filePath) {
    const stat = fs.statSync(filePath)
    if (stat.size !== model.sizeBytes || sha256(filePath) !== model.sha256) {
        throw new Error(`${model.id} does not match manifest size/checksum`)
    }
}

function prepareModels(modelRoot, embeddingIds) {
    const segmentationArchive = path.join(modelRoot, 'segmentation.tar.bz2')
    const segmentationDir = path.join(
        modelRoot,
        'sherpa-onnx-pyannote-segmentation-3-0'
    )
    const segmentationPath = path.join(
        segmentationDir,
        SHERPA.segmentation.file
    )
    if (!fs.existsSync(segmentationPath)) {
        download(
            'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2',
            segmentationArchive
        )
        run('tar', ['-xjf', segmentationArchive, '-C', modelRoot])
    }
    verifyModel(SHERPA.segmentation, segmentationPath)
    const observedHashes = {
        segmentation: sha256(segmentationPath),
        embeddings: {},
    }
    for (const model of SHERPA.embeddings.filter(({ id }) =>
        embeddingIds.has(id)
    )) {
        const filePath = path.join(modelRoot, model.file)
        download(
            `https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/${model.file}`,
            filePath
        )
        verifyModel(model, filePath)
        observedHashes.embeddings[model.id] = sha256(filePath)
    }
    return observedHashes
}

function getCases() {
    const speakerCount = MANIFEST.dataset.parityMeeting.referenceSpeakerCount
    return [
        {
            label: `python-fixed${speakerCount}-${SHERPA.oracleEmbeddingId}`,
            embeddingModelId: SHERPA.oracleEmbeddingId,
            numClusters: speakerCount,
            threshold: 0.5,
        },
        ...SHERPA.automaticThresholds.map((threshold) => ({
            label: `python-auto-${SHERPA.automaticEmbeddingId}-t${threshold}`,
            embeddingModelId: SHERPA.automaticEmbeddingId,
            numClusters: -1,
            threshold,
        })),
    ]
}

function main() {
    const releaseHostLock = acquireBenchmarkHostLock(
        AGENT_ROOT,
        'sherpa-python'
    )
    try {
        const python = process.env.SHERPA_PYTHON
        const scorerPython = process.env.PYANNOTE_PYTHON || python
        const audioRoot = process.env.AMI_AUDIO_ROOT
        if (!python) throw new Error('SHERPA_PYTHON is required')
        if (!audioRoot) throw new Error('AMI_AUDIO_ROOT is required')
        const version = run(python, [
            '-c',
            'import sherpa_onnx; print(sherpa_onnx.__version__)',
        ])
        if (version !== SHERPA.version) {
            throw new Error(
                `sherpa-onnx ${version} installed, expected ${SHERPA.version}`
            )
        }
        const meeting = MANIFEST.dataset.parityMeeting
        const audioPath = path.join(
            audioRoot,
            meeting.id,
            'audio',
            `${meeting.id}.Mix-Headset.wav`
        )
        const modelRoot = path.join(
            AGENT_ROOT,
            'models',
            `sherpa-${SHERPA.version}`
        )
        fs.mkdirSync(modelRoot, { recursive: true })
        const cases = getCases()
        const modelRevisionOrHashes = prepareModels(
            modelRoot,
            new Set(
                cases.map((benchmarkCase) => benchmarkCase.embeddingModelId)
            )
        )
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const runDir = path.join(
            AGENT_ROOT,
            'reports',
            `sherpa-python-${stamp}`
        )
        fs.mkdirSync(runDir, { recursive: true })
        const casesPath = path.join(runDir, 'cases.json')
        const rawPath = path.join(runDir, 'report.json')
        fs.writeFileSync(casesPath, `${JSON.stringify(cases, null, 2)}\n`)
        run(python, [
            PYTHON_RUNNER,
            '--wav',
            audioPath,
            '--models-dir',
            modelRoot,
            '--cases-json',
            casesPath,
            '--out',
            rawPath,
            '--num-threads',
            String(SHERPA.numThreads),
        ])

        const referencePath = path.join(runDir, 'reference.json')
        const referenceUrl =
            `https://raw.githubusercontent.com/${MANIFEST.dataset.reference.repository}/` +
            `${MANIFEST.dataset.reference.commit}/only_words/rttms/test/${meeting.id}.rttm`
        const rttmPath = path.join(runDir, `${meeting.id}.rttm`)
        download(referenceUrl, rttmPath)
        const script =
            `import fs from 'node:fs'; import {parseAmiRttm} from ` +
            `'${path.join(SCRIPT_DIR, 'ami-reference.mjs')}'; ` +
            `fs.writeFileSync('${referencePath}', JSON.stringify({segments: parseAmiRttm(fs.readFileSync('${rttmPath}','utf8'),'${meeting.id}',0,${meeting.durationSeconds})}));`
        run(process.execPath, ['--input-type=module', '-e', script])
        const strictPath = path.join(runDir, 'strict-score.json')
        const standardPath = path.join(runDir, 'standard-score.json')
        run(scorerPython, [
            SCORER,
            '--reference',
            referencePath,
            '--hypothesis',
            rawPath,
            '--uem',
            'full',
            '--out',
            strictPath,
        ])
        run(scorerPython, [
            SCORER,
            '--reference',
            referencePath,
            '--hypothesis',
            rawPath,
            '--uem',
            'full',
            '--collar',
            '0.25',
            '--skip-overlap',
            '--out',
            standardPath,
        ])
        const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'))
        const strict = JSON.parse(fs.readFileSync(strictPath, 'utf8')).results
        const standard = JSON.parse(
            fs.readFileSync(standardPath, 'utf8')
        ).results
        const strictByLabel = new Map(
            strict.map((row) => [row.label, row.score])
        )
        const standardByLabel = new Map(
            standard.map((row) => [row.label, row.score])
        )
        const summary = {
            schemaVersion: 1,
            benchmarkVersion: MANIFEST.benchmarkVersion,
            createdAt: new Date().toISOString(),
            gitCommit: run('git', ['rev-parse', 'HEAD']),
            runtimeVersion: version,
            modelRevisionOrHashes,
            hostHardware: {
                hostname: os.hostname(),
                model: run('sysctl', ['-n', 'hw.model']),
                architecture: os.arch(),
            },
            platform: 'macos-python',
            audioSha256: meeting.audioSha256,
            rows: raw.result.results.map((entry) => ({
                label: entry.result.label,
                speakerCountMode:
                    entry.result.numClusters > 0 ? 'supplied' : 'automatic',
                detectedSpeakerCount: entry.result.numSpeakers,
                processSeconds: entry.result.timing.processMs / 1000,
                rtfx:
                    meeting.durationSeconds /
                    (entry.result.timing.processMs / 1000),
                standardDerPercent: standardByLabel.get(entry.result.label)
                    .diarizationErrorRatePercent,
                standardJerPercent: standardByLabel.get(entry.result.label)
                    .jaccardErrorRatePercent,
                strictDerPercent: strictByLabel.get(entry.result.label)
                    .diarizationErrorRatePercent,
                strictJerPercent: strictByLabel.get(entry.result.label)
                    .jaccardErrorRatePercent,
            })),
            rawReport: rawPath,
        }
        const summaryPath = path.join(runDir, 'summary.json')
        fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
        console.log(
            JSON.stringify({ summary: summaryPath, raw: rawPath }, null, 2)
        )
    } finally {
        releaseHostLock()
    }
}

main()
