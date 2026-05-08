#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, '..')
const packageJson = JSON.parse(
  fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')
)

const version = packageJson.version
const releaseTag = encodeURIComponent(`@siteed/moonshine.rn@${version}`)
const defaultUrl = `https://github.com/deeeed/audiolab/releases/download/${releaseTag}/Moonshine.xcframework.zip`
const artifactUrl =
  process.env.SITEED_MOONSHINE_IOS_XCFRAMEWORK_URL?.trim() || defaultUrl
const sha256 =
  process.env.SITEED_MOONSHINE_IOS_XCFRAMEWORK_SHA256?.trim() ||
  packageJson.moonshineArtifacts?.ios?.xcframeworkSha256

if (!sha256 || !/^[a-f0-9]{64}$/i.test(sha256)) {
  throw new Error(
    'package.json must define moonshineArtifacts.ios.xcframeworkSha256 ' +
      'or SITEED_MOONSHINE_IOS_XCFRAMEWORK_SHA256 must be set before publish'
  )
}

const response = await fetch(artifactUrl, {
  method: 'HEAD',
  redirect: 'follow',
})

if (!response.ok) {
  throw new Error(
    `Moonshine iOS release artifact is not reachable (${response.status} ${response.statusText}): ${artifactUrl}`
  )
}

const length = response.headers.get('content-length')
const contentType = response.headers.get('content-type')

console.log('Moonshine iOS release artifact is reachable.')
console.log(`URL: ${artifactUrl}`)
console.log(`SHA256: ${sha256}`)
if (length) console.log(`Content-Length: ${length} bytes`)
if (contentType) console.log(`Content-Type: ${contentType}`)
