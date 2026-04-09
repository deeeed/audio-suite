#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..')
const BRIDGE = path.join(
  REPO_ROOT,
  'apps',
  'playground',
  'scripts',
  'agentic',
  'cdp-bridge.mjs'
)

function run(command, args, { parseJson = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  })

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(output || `${command} ${args.join(' ')} failed`)
  }

  const stdout = (result.stdout || '').trim()
  if (!parseJson) return stdout
  return stdout ? JSON.parse(stdout) : null
}

function bridge(args, parseJson = true) {
  return run('node', [BRIDGE, ...args], { parseJson })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const modelId = process.argv[2] || 'moonshine-small-streaming-en'
  const deviceFilter = process.argv[3]
  const sample = process.argv[4] || 'speech'
  const argsPrefix = deviceFilter ? ['--device', deviceFilter] : []
  const op = 'validateMoonshineOfflineContract'

  bridge(
    [
      ...argsPrefix,
      'eval',
      `globalThis.__AGENTIC__?.validateMoonshineOfflineContract?.(${JSON.stringify(
        modelId
      )}, { sample: ${JSON.stringify(sample)}, wordTimestamps: true })`,
    ],
    false
  )

  const startedAt = Date.now()
  while (Date.now() - startedAt < 120000) {
    const result = bridge(
      [...argsPrefix, 'eval', 'globalThis.__AGENTIC__?.getLastResult?.()'],
      true
    )
    if (result?.op === op && result?.status && result.status !== 'pending') {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      return
    }
    await sleep(1000)
  }

  throw new Error(`${op} timed out`)
}

await main()
