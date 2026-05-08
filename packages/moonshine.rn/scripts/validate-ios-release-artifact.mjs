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

const { response, method } = await checkArtifactUrl(artifactUrl)

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
console.log(`Checked-With: ${method}`)
if (length) console.log(`Content-Length: ${length} bytes`)
if (contentType) console.log(`Content-Type: ${contentType}`)
