#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, '..')
const ANDROID_AAR = 'prebuilt/android/moonshine-voice-source-release.aar'
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(
      [result.stdout, result.stderr].filter(Boolean).join('\n').trim() ||
        `${command} ${args.join(' ')} failed with status ${result.status}`
    )
  }
  return result.stdout.trim()
}

function findCommand(candidates) {
  for (const command of candidates) {
    const result = spawnSync('which', [command], { encoding: 'utf8' })
    if (result.status === 0 && result.stdout.trim()) return command
  }
  return null
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

function parsePackOutput(packOutput) {
  const jsonStart = packOutput.search(/\[\s*\{/)
  if (jsonStart === -1) {
    throw new Error(`Unable to parse npm pack JSON output:\n${packOutput}`)
  }
  return JSON.parse(packOutput.slice(jsonStart))[0]
}

function listZipEntries(zipPath) {
  return run('unzip', ['-Z1', zipPath], { cwd: PACKAGE_ROOT })
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function inspectSymbols(readelfCommand, soPath) {
  return run(readelfCommand, ['--dyn-symbols', '--wide', soPath], { cwd: PACKAGE_ROOT })
}

function inspectAndroidAar(aarPath) {
  const aarEntries = listZipEntries(aarPath)
  const abiNames = [
    ...new Set(
      aarEntries
        .map((entry) => entry.match(/^jni\/([^/]+)\//)?.[1])
        .filter(Boolean)
    ),
  ].sort()
  if (abiNames.length === 0) {
    throw new Error(`${aarPath} does not package any jni/<abi>/ native libraries`)
  }

  const readelfCommand = findCommand(['llvm-readelf', 'readelf'])
  if (!readelfCommand) {
    throw new Error(
      'Unable to inspect Android native symbols: llvm-readelf/readelf is required. ' +
        'On macOS, install it with `brew install llvm` and ensure llvm-readelf is on PATH.'
    )
  }

  const aarExtractDir = fs.mkdtempSync(path.join(path.dirname(aarPath), 'aar-inspect-'))
  fs.mkdirSync(aarExtractDir, { recursive: true })
  try {
    run('unzip', ['-q', aarPath, '-d', aarExtractDir], { cwd: PACKAGE_ROOT })

    const abiReports = []
    for (const abi of abiNames) {
      const requiredLibs = ['libmoonshine.so', 'libmoonshine-jni.so']
      const missingLibs = requiredLibs.filter(
        (lib) => !aarEntries.includes(`jni/${abi}/${lib}`)
      )
      if (missingLibs.length > 0) {
        throw new Error(
          `${aarPath} is missing required native libs for ${abi}: ${missingLibs.join(', ')}`
        )
      }

      for (const lib of requiredLibs) {
        const symbols = inspectSymbols(readelfCommand, path.join(aarExtractDir, 'jni', abi, lib))
        if (/OrtGetApiBase@+VERS_/.test(symbols)) {
          throw new Error(
            `${aarPath} ${abi}/${lib} imports a versioned OrtGetApiBase symbol; ` +
              'expected no OrtGetApiBase@VERS_ imports'
          )
        }
      }

      const bundlesOnnxRuntime = aarEntries.includes(`jni/${abi}/libonnxruntime.so`)
      abiReports.push({ abi, bundlesOnnxRuntime })
    }

    return abiReports
  } finally {
    fs.rmSync(aarExtractDir, { recursive: true, force: true })
  }
}

const iosDynamicArtifacts = [
  'prebuilt/ios/Moonshine.xcframework/Info.plist',
  'prebuilt/ios/Moonshine.xcframework/ios-arm64/libmoonshine.a',
  'prebuilt/ios/Moonshine.xcframework/ios-arm64/Headers/moonshine-c-api.h',
  'prebuilt/ios/Moonshine.xcframework/ios-arm64/Headers/module.modulemap',
  'prebuilt/ios/Moonshine.xcframework/ios-arm64_x86_64-simulator/libmoonshine.a',
  'prebuilt/ios/Moonshine.xcframework/ios-arm64_x86_64-simulator/Headers/moonshine-c-api.h',
  'prebuilt/ios/Moonshine.xcframework/ios-arm64_x86_64-simulator/Headers/module.modulemap',
]

const androidGradle = fs.readFileSync(path.join(PACKAGE_ROOT, 'android/build.gradle'), 'utf8')
const podspec = fs.readFileSync(path.join(PACKAGE_ROOT, 'Moonshine.podspec'), 'utf8')
const expectedMoonshineVersion = packageJson.moonshineVersion.replace(/^v/, '')
const expectedMavenCoord = `ai.moonshine:moonshine-voice:${expectedMoonshineVersion}`
if (!androidGradle.includes(expectedMavenCoord)) {
  throw new Error(
    `Moonshine Android Maven fallback mismatch. Expected build.gradle to contain ${expectedMavenCoord}`
  )
}
if (!androidGradle.includes('SITEED_MOONSHINE_ANDROID_USE_MAVEN')) {
  throw new Error('Moonshine Android Maven override must remain explicit in build.gradle')
}
if (!androidGradle.includes('file(moonshineAndroidSourceAar).exists()')) {
  throw new Error('Moonshine Android Gradle must dynamically use a source AAR only when it exists')
}
if (!packageJson.files.includes(`!${ANDROID_AAR}`)) {
  throw new Error(`Public npm package must exclude heavyweight Android AAR: ${ANDROID_AAR}`)
}
if (!packageJson.files.includes('!prebuilt/ios/Moonshine.xcframework/**')) {
  throw new Error('Public npm package must exclude heavyweight iOS xcframework binaries')
}
if (!packageJson.files.includes('scripts/ensure-ios-artifacts.sh')) {
  throw new Error('Public npm package must include the iOS artifact downloader script')
}
if (!podspec.includes('scripts/ensure-ios-artifacts.sh')) {
  throw new Error('Moonshine podspec must dynamically prepare missing iOS artifacts')
}
if (!packageJson.scripts?.prepublishOnly?.includes('validate:ios-release-artifact')) {
  throw new Error('npm publish must be gated on the iOS release artifact URL')
}
if (!/^[a-f0-9]{64}$/i.test(packageJson.moonshineArtifacts?.ios?.xcframeworkSha256 || '')) {
  throw new Error(
    'package.json must pin moonshineArtifacts.ios.xcframeworkSha256 for default iOS install integrity'
  )
}
if (!podspec.includes('prepare_command')) {
  throw new Error('Moonshine podspec must prepare missing iOS artifacts during CocoaPods install')
}

const packOutput = run('npm', ['pack', '--json', '--dry-run'])
const packInfo = parsePackOutput(packOutput)
const packedFiles = new Set(packInfo.files.map((file) => file.path))

assertPacked(packedFiles, 'scripts/ensure-ios-artifacts.sh')
for (const file of iosDynamicArtifacts) assertNotPacked(packedFiles, file)
assertNotPacked(packedFiles, 'prebuilt/ios/current/libmoonshine_core.a')
assertNotPacked(packedFiles, ANDROID_AAR)

console.log('Moonshine native release validation passed.')
console.log('iOS xcframework binaries are excluded from npm and prepared dynamically by CocoaPods.')
console.log(`Android public npm tarball excludes heavyweight AAR: ${ANDROID_AAR}`)
console.log(`Android published consumers resolve Moonshine dynamically from Maven: ${expectedMavenCoord}`)
console.log('Repo-local generated prebuilt/ios/current/ artifacts are intentionally excluded from npm.')

const localAarPath = path.join(PACKAGE_ROOT, ANDROID_AAR)
if (fs.existsSync(localAarPath)) {
  const androidAbiReports = inspectAndroidAar(localAarPath)
  const bundledOnnxAbis = androidAbiReports
    .filter((report) => report.bundlesOnnxRuntime)
    .map((report) => report.abi)
  const externalOnnxAbis = androidAbiReports
    .filter((report) => !report.bundlesOnnxRuntime)
    .map((report) => report.abi)

  console.log(
    `Repo-local Android AAR ABIs inspected: ${androidAbiReports
      .map((report) => report.abi)
      .join(', ')}`
  )
  console.log(
    'Android libmoonshine.so and libmoonshine-jni.so have no OrtGetApiBase@VERS_ imports.'
  )
  if (bundledOnnxAbis.length > 0) {
    console.log(
      `Android AAR bundles libonnxruntime.so for: ${bundledOnnxAbis.join(', ')}. ` +
        'Do not also package a conflicting app-level ONNX Runtime for those ABIs.'
    )
  }
  if (externalOnnxAbis.length > 0) {
    console.log(
      `Android AAR does not bundle libonnxruntime.so for: ${externalOnnxAbis.join(', ')}. ` +
        'A source-AAR consumer must provide a compatible ONNX Runtime for those ABIs.'
    )
  }
} else {
  console.log('Repo-local Android AAR is absent; skipped optional source-AAR symbol inspection.')
}
