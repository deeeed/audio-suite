#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, '..')
const SOURCE_SCRIPT = path.join(PACKAGE_ROOT, 'scripts/ensure-ios-artifacts.sh')
const TEST_VERSION = '0.0.0-test'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'moonshine-ios-artifacts-'))
const packageDir = path.join(tempRoot, 'package')
const scriptPath = path.join(packageDir, 'scripts/ensure-ios-artifacts.sh')
const cacheRoot = path.join(tempRoot, 'cache')
const artifactRoot = path.join(tempRoot, 'artifact')
const goodZip = path.join(tempRoot, 'Moonshine.xcframework.zip')
const SAFE_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: tempRoot,
    encoding: 'utf8',
    ...options,
  })

  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(' ')} failed with status ${result.status}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n')
    )
  }

  return result
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function resetGeneratedArtifacts() {
  fs.rmSync(path.join(packageDir, 'prebuilt/ios/Moonshine.xcframework'), {
    recursive: true,
    force: true,
  })
  fs.rmSync(path.join(packageDir, 'prebuilt/ios/current'), {
    recursive: true,
    force: true,
  })
}

function assertFile(relativePath) {
  const absolutePath = path.join(packageDir, relativePath)
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Expected file to exist: ${relativePath}`)
  }
}

function cacheZipPath(expectedSha) {
  return path.join(cacheRoot, `${TEST_VERSION}-${expectedSha}`, 'Moonshine.xcframework.zip')
}

function runInstaller(envOverrides = {}, expectedStatus = 0) {
  const result = spawnSync('/bin/bash', [scriptPath], {
    cwd: packageDir,
    encoding: 'utf8',
    env: {
      PATH: SAFE_PATH,
      HOME: process.env.HOME || '',
      SITEED_MOONSHINE_IOS_CACHE_DIR: cacheRoot,
      SITEED_MOONSHINE_IOS_XCFRAMEWORK_URL: pathToFileURL(goodZip).href,
      ...envOverrides,
    },
  })

  if (result.status !== expectedStatus) {
    throw new Error(
      [
        `ensure-ios-artifacts.sh exited with ${result.status}; expected ${expectedStatus}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n')
    )
  }

  return result
}

function assertGeneratedArtifacts() {
  assertFile('prebuilt/ios/Moonshine.xcframework/ios-arm64/libmoonshine.a')
  assertFile(
    'prebuilt/ios/Moonshine.xcframework/ios-arm64_x86_64-simulator/libmoonshine.a'
  )
}

try {
  fs.mkdirSync(path.join(packageDir, 'scripts'), { recursive: true })
  fs.copyFileSync(SOURCE_SCRIPT, scriptPath)

  const deviceSlice = path.join(
    artifactRoot,
    'Moonshine.xcframework/ios-arm64'
  )
  const simulatorSlice = path.join(
    artifactRoot,
    'Moonshine.xcframework/ios-arm64_x86_64-simulator'
  )
  fs.mkdirSync(deviceSlice, { recursive: true })
  fs.mkdirSync(simulatorSlice, { recursive: true })
  fs.writeFileSync(path.join(deviceSlice, 'libmoonshine.a'), 'device')
  fs.writeFileSync(path.join(simulatorSlice, 'libmoonshine.a'), 'simulator')
  run('/usr/bin/zip', ['-qry', goodZip, 'Moonshine.xcframework'], {
    cwd: artifactRoot,
  })

  const goodSha = sha256(goodZip)
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify(
      {
        name: '@siteed/moonshine.rn-test',
        version: TEST_VERSION,
        moonshineArtifacts: { ios: { xcframeworkSha256: goodSha } },
      },
      null,
      2
    )
  )

  resetGeneratedArtifacts()
  runInstaller()
  assertGeneratedArtifacts()
  if (!fs.existsSync(cacheZipPath(goodSha))) {
    throw new Error('Expected first install to seed the external cache')
  }

  resetGeneratedArtifacts()
  runInstaller({ SITEED_MOONSHINE_IOS_XCFRAMEWORK_URL: 'file:///does/not/exist.zip' })
  assertGeneratedArtifacts()

  resetGeneratedArtifacts()
  fs.writeFileSync(cacheZipPath(goodSha), 'corrupt cache')
  const corruptCacheResult = runInstaller()
  assertGeneratedArtifacts()
  if (!corruptCacheResult.stderr.includes('Discarding invalid cached')) {
    throw new Error('Expected corrupt cache run to report cache discard')
  }
  if (sha256(cacheZipPath(goodSha)) !== goodSha) {
    throw new Error('Expected corrupt cache to be replaced with the downloaded artifact')
  }

  resetGeneratedArtifacts()
  const wrongSha = '0'.repeat(64)
  const mismatchCachePath = cacheZipPath(wrongSha)
  const mismatchResult = runInstaller(
    { SITEED_MOONSHINE_IOS_XCFRAMEWORK_SHA256: wrongSha },
    1
  )
  if (!mismatchResult.stderr.includes('failed checksum verification')) {
    throw new Error('Expected checksum mismatch run to fail explicitly')
  }
  if (fs.existsSync(mismatchCachePath)) {
    throw new Error('Checksum mismatch must not poison the cache')
  }

  const noCacheRootResult = runInstaller(
    {
      HOME: '',
      XDG_CACHE_HOME: '',
      SITEED_MOONSHINE_IOS_CACHE_DIR: '',
    },
    1
  )
  if (!noCacheRootResult.stderr.includes('Unable to determine')) {
    throw new Error('Expected missing cache-root run to fail loudly')
  }

  console.log('Moonshine iOS artifact script tests passed.')
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
