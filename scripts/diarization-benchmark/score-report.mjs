#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadOfficialAmiReference } from './ami-reference.mjs'
import {
    benchmarkAllowedRoots,
    resolveAllowedExistingPath,
    resolveAllowedOutputPath,
} from './path-policy.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const ALLOWED_ROOTS = benchmarkAllowedRoots(REPO_ROOT)
const SCORER = path.join(
    REPO_ROOT,
    'apps',
    'sherpa-voice',
    'scripts',
    'diarization-score-pyannote.py'
)

function parseArgs(argv) {
    const args = {
        python: process.env.PYANNOTE_PYTHON || 'python3',
        rttmRoot: process.env.AMI_RTTM_ROOT || '',
    }
    for (let index = 2; index < argv.length; index += 1) {
        const key = argv[index]
        const value = argv[index + 1]
        if (key === '--input') args.input = value
        else if (key === '--out') args.out = value
        else if (key === '--python') args.python = value
        else if (key === '--rttm-root') args.rttmRoot = value
        else throw new Error(`Unknown argument: ${key}`)
        index += 1
    }
    if (!args.input) throw new Error('--input is required')
    return args
}

function score(python, referencePath, hypothesisPath, profile) {
    const commandArgs = [
        SCORER,
        '--reference',
        referencePath,
        '--hypothesis',
        hypothesisPath,
        '--uem',
        'full',
    ]
    if (profile === 'standard') {
        commandArgs.push('--collar', '0.25', '--skip-overlap')
    }
    const result = spawnSync(python, commandArgs, {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
    })
    if (result.status !== 0) {
        throw new Error(result.stderr || `${python} scorer failed`)
    }
    return JSON.parse(result.stdout).results[0].score
}

function getCandidates(clip) {
    if (Array.isArray(clip.rows)) {
        return clip.rows.map((row) => ({
            label: row.result.label,
            segments: row.result.segments,
            target: row,
        }))
    }
    if (Array.isArray(clip.results)) {
        return clip.results.map((result) => ({
            label: result.modelId,
            segments:
                result.diarizationSegments ||
                result.alignedLines
                    ?.filter(
                        (line) =>
                            line.predictedSpeaker !== 'unknown' &&
                            line.startedAtMs != null &&
                            line.completedAtMs != null &&
                            line.completedAtMs > line.startedAtMs
                    )
                    .map((line) => ({
                        start: line.startedAtMs / 1000,
                        end: line.completedAtMs / 1000,
                        speaker: line.predictedSpeaker,
                    })),
            target: result,
        }))
    }
    throw new TypeError(`Unsupported clip result shape: ${clip.id}`)
}

function readReport(inputPath) {
    const inputIsDirectory = fs.statSync(inputPath).isDirectory() // NOSONAR: validated path.
    if (!inputIsDirectory) {
        return JSON.parse(fs.readFileSync(inputPath, 'utf8')) // NOSONAR: canonical allowed-root path.
    }

    const files = fs
        .readdirSync(inputPath) // NOSONAR: canonical allowed-root path.
        .filter((name) => name.endsWith('.json'))
        .sort()
    const clips = files.map((name) => {
        if (name !== path.basename(name)) {
            throw new TypeError(`Invalid report file name: ${name}`)
        }
        const reportPath = resolveAllowedExistingPath(
            path.join(inputPath, name),
            ALLOWED_ROOTS,
            'file'
        )
        const raw = JSON.parse(fs.readFileSync(reportPath, 'utf8')) // NOSONAR: canonical allowed-root path.
        const meetingId = path.basename(name, '.json')
        if (
            !Array.isArray(raw.segments) ||
            !Number.isFinite(raw.durationSeconds)
        ) {
            throw new TypeError(`${name} is not a FluidAudio process result`)
        }
        const segments = raw.segments.map((segment) => ({
            start: segment.start ?? segment.startTimeSeconds,
            end: segment.end ?? segment.endTimeSeconds,
            speaker: segment.speaker ?? segment.speakerId,
        }))
        return {
            id: meetingId,
            meetingId,
            startS: 0,
            endS: raw.durationSeconds,
            reference: {},
            rows: [
                {
                    case: {
                        label: 'fluidaudio-offline-vbx',
                        numClusters: -1,
                    },
                    result: {
                        label: 'fluidaudio-offline-vbx',
                        numSpeakers: new Set(
                            segments.map((segment) => segment.speaker)
                        ).size,
                        segmentCount: segments.length,
                        durationMs: raw.durationSeconds * 1000,
                        timing: {
                            processMs: raw.processingTimeSeconds * 1000,
                        },
                        segments,
                    },
                    sourceResult: reportPath,
                },
            ],
        }
    })
    return {
        createdAt: new Date().toISOString(),
        sourceType: 'FluidAudio process results',
        clips,
    }
}

function main() {
    const args = parseArgs(process.argv)
    const inputPath = resolveAllowedExistingPath(args.input, ALLOWED_ROOTS)
    const outputPath = args.out
        ? resolveAllowedOutputPath(args.out, ALLOWED_ROOTS)
        : null
    const report = readReport(inputPath)
    if (!Array.isArray(report.clips)) {
        throw new TypeError('Input report does not contain clips')
    }
    const temporaryDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'audiolab-diarization-score-')
    )
    try {
        for (const clip of report.clips) {
            const official = loadOfficialAmiReference({
                meetingId: clip.meetingId,
                startS: clip.startS,
                endS: clip.endS,
                cacheDir: path.join(path.dirname(inputPath), 'references'),
                rttmRoot: args.rttmRoot,
            })
            const referencePath = path.join(
                temporaryDir,
                `${clip.id}-reference.json`
            )
            fs.writeFileSync(
                referencePath,
                JSON.stringify({ segments: official.segments })
            )
            clip.reference = {
                ...clip.reference,
                speakerCount: new Set(
                    official.segments.map((row) => row.speaker)
                ).size,
                segmentCount: official.segments.length,
                segments: official.segments,
                source: official.source,
                sourceUrl: official.sourceUrl,
                setup: official.setup,
                setupCommit: official.setupCommit,
            }

            for (const candidate of getCandidates(clip)) {
                if (!Array.isArray(candidate.segments)) {
                    throw new TypeError(
                        `${clip.id} ${candidate.label} has no segments`
                    )
                }
                const hypothesisPath = path.join(
                    temporaryDir,
                    `${clip.id}-${candidate.label}.json`
                )
                fs.writeFileSync(
                    hypothesisPath,
                    JSON.stringify({ segments: candidate.segments })
                )
                candidate.target.benchmarkScores = {
                    strict: score(
                        args.python,
                        referencePath,
                        hypothesisPath,
                        'strict'
                    ),
                    standard: score(
                        args.python,
                        referencePath,
                        hypothesisPath,
                        'standard'
                    ),
                }
            }
        }
    } finally {
        fs.rmSync(temporaryDir, { recursive: true, force: true })
    }

    const rendered = `${JSON.stringify(report, null, 2)}\n`
    if (outputPath)
        fs.writeFileSync(outputPath, rendered) // NOSONAR: validated output path.
    else process.stdout.write(rendered)
}

main()
