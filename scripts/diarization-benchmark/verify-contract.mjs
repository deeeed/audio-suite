#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AMI_DIARIZATION_SETUP_COMMIT } from './ami-reference.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')

function readJson(relativePath) {
    return JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
    )
}

function readText(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
}

function assert(condition, message) {
    if (!condition) throw new Error(message)
}

function main() {
    const manifest = readJson('benchmarks/on-device-diarization/manifest.json')
    const result = readJson(
        'apps/sherpa-voice/benchmarks/results/2026-08-25-ami-diarization.json'
    )
    const sherpaPackage = readJson('packages/sherpa-onnx.rn/package.json')
    const moonshinePackage = readJson('packages/moonshine.rn/package.json')
    const moonshineAndroid = readText(
        'packages/moonshine.rn/android/src/main/java/net/siteed/moonshine/MoonshineModule.kt'
    )
    const moonshineIos = readText('packages/moonshine.rn/ios/Moonshine.mm')

    assert(
        manifest.schemaVersion === 1,
        'Unsupported benchmark manifest schema'
    )
    assert(
        manifest.dataset.reference.commit === AMI_DIARIZATION_SETUP_COMMIT,
        'AMI reference commit differs between manifest and scorer'
    )
    assert(
        new Set(manifest.dataset.testMeetings).size === 16,
        'AMI test split must contain 16 unique meetings'
    )
    assert(
        sherpaPackage.sherpaOnnxVersion === manifest.systems.sherpaOnnx.version,
        'Sherpa package and benchmark runtime versions differ'
    )
    assert(
        moonshinePackage.moonshineAndroidVersion ===
            manifest.systems.moonshine.androidVersion,
        'Moonshine Android package and benchmark runtime versions differ'
    )
    assert(
        moonshinePackage.moonshineVersion ===
            manifest.systems.moonshine.iosVersion,
        'Moonshine iOS package and benchmark runtime versions differ'
    )
    assert(
        moonshineAndroid.includes('TranscriberOption("diarization_model_dir"'),
        'Android 0.1.5 must forward the external diarization model directory'
    )
    assert(
        !moonshineIos.includes('addOption(@"diarization_model_dir"'),
        'Pinned iOS v0.0.59 must not receive the unsupported diarization_model_dir option'
    )
    assert(
        result.benchmarkVersion === manifest.benchmarkVersion,
        'Result and manifest benchmark versions differ'
    )

    for (const model of [
        manifest.systems.sherpaOnnx.segmentation,
        ...manifest.systems.sherpaOnnx.embeddings,
    ]) {
        assert(model.sizeBytes > 0, `${model.id} is missing sizeBytes`)
        assert(
            /^[a-f0-9]{64}$/.test(model.sha256),
            `${model.id} is missing a SHA-256 checksum`
        )
    }

    const gate = manifest.qualityGates.automaticCount
    const fluid = result.fluidAudioFullAmiTest
    assert(
        fluid.meetingCount === gate.requiredMeetingCount,
        'FluidAudio result does not cover the required AMI meetings'
    )
    assert(
        fluid.standardDerPercent <= gate.maxMacroDerPercent,
        `FluidAudio DER ${fluid.standardDerPercent} exceeds ${gate.maxMacroDerPercent}`
    )
    assert(
        fluid.standardJerPercent <= gate.maxMacroJerPercent,
        `FluidAudio JER ${fluid.standardJerPercent} exceeds ${gate.maxMacroJerPercent}`
    )
    assert(
        fluid.speakerCountExactMeetings >= gate.minExactSpeakerCountMeetings,
        'FluidAudio exact speaker-count coverage is below the gate'
    )
    assert(
        result.upstreamSherpaParity.cases.every((entry) => entry.matchesPixel),
        'Sherpa Python and Pixel parity failed'
    )
    console.log(
        JSON.stringify(
            {
                benchmarkVersion: manifest.benchmarkVersion,
                result: 'valid',
                fluidAudio: {
                    derPercent: fluid.standardDerPercent,
                    jerPercent: fluid.standardJerPercent,
                    exactSpeakerCounts: `${fluid.speakerCountExactMeetings}/${fluid.meetingCount}`,
                },
            },
            null,
            2
        )
    )
}

main()
