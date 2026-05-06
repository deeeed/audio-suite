#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, '..')
const packageJson = JSON.parse(
  fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')
)

if (!packageJson.moonshineVersion) {
  throw new Error('package.json must define moonshineVersion for native release validation')
}

function assertFile(relativePath) {
  const absolutePath = path.join(PACKAGE_ROOT, relativePath)
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing required Moonshine native file: ${relativePath}`)
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join('\n').trim())
  }
  return result.stdout.trim()
}

function assertPacked(files, relativePath) {
  if (!files.has(relativePath)) {
    throw new Error(`npm package would miss required native file: ${relativePath}`)
  }
}

function assertNotPacked(files, relativePath) {
  if (files.has(relativePath)) {
    throw new Error(`npm package unexpectedly includes repo-local artifact: ${relativePath}`)
  }
}

const iosRequired = [
  'prebuilt/ios/Moonshine.xcframework/Info.plist',
  'prebuilt/ios/Moonshine.xcframework/ios-arm64/libmoonshine.a',
  'prebuilt/ios/Moonshine.xcframework/ios-arm64/Headers/moonshine-c-api.h',
  'prebuilt/ios/Moonshine.xcframework/ios-arm64/Headers/module.modulemap',
  'prebuilt/ios/Moonshine.xcframework/ios-arm64_x86_64-simulator/libmoonshine.a',
  'prebuilt/ios/Moonshine.xcframework/ios-arm64_x86_64-simulator/Headers/moonshine-c-api.h',
  'prebuilt/ios/Moonshine.xcframework/ios-arm64_x86_64-simulator/Headers/module.modulemap',
]

for (const file of iosRequired) assertFile(file)

const androidGradle = fs.readFileSync(path.join(PACKAGE_ROOT, 'android/build.gradle'), 'utf8')
const expectedMoonshineVersion = packageJson.moonshineVersion.replace(/^v/, '')
const expectedMavenCoord = `ai.moonshine:moonshine-voice:${expectedMoonshineVersion}`
if (!androidGradle.includes(expectedMavenCoord)) {
  throw new Error(
    `Moonshine Android Maven fallback mismatch. Expected build.gradle to contain ${expectedMavenCoord}`
  )
}

const packOutput = run('npm', ['pack', '--json', '--dry-run'])
const jsonStart = packOutput.search(/\[\s*\{/)
if (jsonStart === -1) {
  throw new Error(`Unable to parse npm pack JSON output:\n${packOutput}`)
}
const [packInfo] = JSON.parse(packOutput.slice(jsonStart))
const packedFiles = new Set(packInfo.files.map((file) => file.path))

for (const file of iosRequired) assertPacked(packedFiles, file)
assertNotPacked(packedFiles, 'prebuilt/ios/current/libmoonshine_core.a')
assertNotPacked(packedFiles, 'prebuilt/android/moonshine-voice-source-release.aar')

console.log('Moonshine native release validation passed.')
console.log(`iOS xcframework slices are packaged for device and simulator.`)
console.log(`Android uses Maven fallback for published consumers: ${expectedMavenCoord}`)
console.log('Repo-local generated current/ and source-built AAR artifacts are intentionally excluded from npm.')
