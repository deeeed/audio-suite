#!/usr/bin/env node

import crypto from 'node:crypto'
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

async function cancelBody(response) {
  await response.body?.cancel().catch(() => {})
}

async function checkArtifactUrl(url) {
  const headResponse = await fetch(url, {
    method: 'HEAD',
    redirect: 'follow',
  })
  await cancelBody(headResponse)

  if (headResponse.ok) {
    return { response: headResponse, method: 'HEAD' }
  }

  if (![405, 501].includes(headResponse.status)) {
    return { response: headResponse, method: 'HEAD' }
  }

  const getResponse = await fetch(url, {
    method: 'GET',
    headers: { Range: 'bytes=0-0' },
    redirect: 'follow',
  })
  await cancelBody(getResponse)
  return { response: getResponse, method: 'GET range' }
}

async function hashArtifactUrl(url) {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
  })

  if (!response.ok) {
    await cancelBody(response)
    throw new Error(
      `Moonshine iOS release artifact could not be downloaded for checksum validation ` +
        `(${response.status} ${response.statusText}): ${url}`
    )
  }

  if (!response.body) {
    throw new Error('Moonshine iOS release artifact response did not include a readable body')
  }

  const hash = crypto.createHash('sha256')
  let bytes = 0
  for await (const chunk of response.body) {
    hash.update(chunk)
    bytes += chunk.byteLength
  }

  return {
    bytes,
    contentLength: response.headers.get('content-length'),
    contentType: response.headers.get('content-type'),
    sha256: hash.digest('hex'),
  }
}

const { response, method } = await checkArtifactUrl(artifactUrl)

if (!response.ok) {
  throw new Error(
    `Moonshine iOS release artifact is not reachable (${response.status} ${response.statusText}): ${artifactUrl}`
  )
}

const artifact = await hashArtifactUrl(artifactUrl)
if (artifact.sha256.toLowerCase() !== sha256.toLowerCase()) {
  throw new Error(
    'Moonshine iOS release artifact checksum mismatch.\n' +
      `URL: ${artifactUrl}\n` +
      `Expected: ${sha256}\n` +
      `Actual:   ${artifact.sha256}`
  )
}

console.log('Moonshine iOS release artifact is reachable and checksum-valid.')
console.log(`URL: ${artifactUrl}`)
console.log(`SHA256: ${sha256}`)
console.log(`Checked-With: ${method}`)
console.log(`Downloaded-Bytes: ${artifact.bytes}`)
if (artifact.contentLength) console.log(`Content-Length: ${artifact.contentLength} bytes`)
if (artifact.contentType) console.log(`Content-Type: ${artifact.contentType}`)
