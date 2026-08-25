#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
)
const releaseTag = encodeURIComponent(
  `@siteed/moonshine.rn@${packageJson.version}`
)
const defaultUrl =
  `https://github.com/deeeed/audiolab/releases/download/${releaseTag}/` +
  'Moonshine-Android-isolated.aar'
const artifactUrl =
  process.env.SITEED_MOONSHINE_ANDROID_ISOLATED_AAR_URL?.trim() || defaultUrl
const expectedSha256 =
  process.env.SITEED_MOONSHINE_ANDROID_ISOLATED_AAR_SHA256?.trim() ||
  packageJson.moonshineArtifacts?.android?.isolatedAarSha256

if (!/^[a-f0-9]{64}$/i.test(expectedSha256 || '')) {
  throw new Error('Moonshine Android release artifact SHA-256 is not pinned')
}

const response = await fetch(artifactUrl, { redirect: 'follow' })
if (!response.ok || !response.body) {
  await response.body?.cancel().catch(() => {})
  throw new Error(
    `Moonshine Android release artifact is not downloadable ` +
      `(${response.status} ${response.statusText}): ${artifactUrl}`
  )
}

const hash = crypto.createHash('sha256')
let bytes = 0
for await (const chunk of response.body) {
  hash.update(chunk)
  bytes += chunk.byteLength
}
const actualSha256 = hash.digest('hex')
if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
  throw new Error(
    `Moonshine Android release artifact checksum mismatch. ` +
      `Expected ${expectedSha256}, got ${actualSha256}`
  )
}

console.log('Moonshine Android release artifact is reachable and checksum-valid.')
console.log(`URL: ${artifactUrl}`)
console.log(`SHA256: ${actualSha256}`)
console.log(`Downloaded-Bytes: ${bytes}`)
