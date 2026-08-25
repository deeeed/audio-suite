#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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

function commandExists(command) {
    return (
        spawnSync('sh', ['-c', `command -v ${command}`], {
            stdio: 'ignore',
        }).status === 0
    )
}

function pythonHas(python, module, version) {
    if (!python || !fs.existsSync(python)) return false
    const code =
        `import importlib.metadata as m; import ${module}; ` +
        `assert m.version('${module.replace('_', '-')}') == '${version}'`
    return spawnSync(python, ['-c', code], { stdio: 'ignore' }).status === 0
}

function sha256(filePath) {
    return crypto
        .createHash('sha256')
        .update(fs.readFileSync(filePath))
        .digest('hex')
}

function simulatorAvailable(name) {
    const result = spawnSync('xcrun', ['simctl', 'list', 'devices', '-j'], {
        encoding: 'utf8',
    })
    if (result.status !== 0) return false
    const value = JSON.parse(result.stdout)
    return Object.values(value.devices || {})
        .flat()
        .some((device) => device.name === name && device.isAvailable)
}

function main() {
    const audioRoot = process.env.AMI_AUDIO_ROOT || ''
    const meeting = MANIFEST.dataset.parityMeeting
    const audioPath = audioRoot
        ? path.join(
              audioRoot,
              meeting.id,
              'audio',
              `${meeting.id}.Mix-Headset.wav`
          )
        : ''
    const checks = {
        manifest: {
            ok: MANIFEST.schemaVersion === 1,
            benchmarkVersion: MANIFEST.benchmarkVersion,
        },
        commands: Object.fromEntries(
            ['node', 'yarn', 'git', 'curl', 'swift', 'xcodebuild', 'xcrun'].map(
                (command) => [command, commandExists(command)]
            )
        ),
        parityAudio: {
            path: audioPath || null,
            exists: Boolean(audioPath && fs.existsSync(audioPath)),
            checksumMatches: Boolean(
                audioPath &&
                    fs.existsSync(audioPath) &&
                    sha256(audioPath) === meeting.audioSha256
            ),
        },
        scorerPython: {
            path: process.env.PYANNOTE_PYTHON || null,
            ready: pythonHas(
                process.env.PYANNOTE_PYTHON,
                'pyannote.metrics',
                '4.0.0'
            ),
        },
        iosSimulator: {
            name: process.env.IOS_SIMULATOR || 'audiolab-1',
            available: simulatorAvailable(
                process.env.IOS_SIMULATOR || 'audiolab-1'
            ),
        },
        sherpaPython: {
            path: process.env.SHERPA_PYTHON || null,
            ready: pythonHas(
                process.env.SHERPA_PYTHON,
                'sherpa_onnx',
                MANIFEST.systems.sherpaOnnx.version
            ),
        },
        pyannoteReference: {
            tokenPresent: Boolean(
                process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN
            ),
            note: 'Optional. Required only for the gated Community-1 Python reference.',
        },
    }
    const requiredReady =
        checks.manifest.ok &&
        Object.values(checks.commands).every(Boolean) &&
        checks.parityAudio.checksumMatches &&
        checks.scorerPython.ready &&
        checks.iosSimulator.available
    console.log(JSON.stringify({ requiredReady, checks }, null, 2))
    if (!requiredReady) process.exitCode = 1
}

main()
