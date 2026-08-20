#!/usr/bin/env node
'use strict'

/**
 * Regenerates packed-manifest.json from `npm pack --dry-run`.
 *
 * Run this whenever a package's `files` field changes. The snapshot is what lets the
 * classifier know which paths actually reach consumers, instead of guessing from path
 * conventions — a guess that was wrong for audio-studio, sherpa-onnx.rn and moonshine.rn
 * in three different directions.
 */

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '../..')
const out = {}

for (const pkg of fs.readdirSync(path.join(repoRoot, 'packages'))) {
  const dir = path.join(repoRoot, 'packages', pkg)
  if (!fs.existsSync(path.join(dir, 'package.json'))) continue
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  if (manifest.private) continue
  try {
    const json = execFileSync(
      'npm',
      ['pack', '--dry-run', '--json', '--ignore-scripts'],
      { cwd: dir, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString()
    out[pkg] = JSON.parse(json)[0].files.map((f) => f.path).sort()
    console.log(`${pkg}: ${out[pkg].length} packed`)
  } catch {
    console.log(`${pkg}: pack failed, skipped`)
  }
}

fs.writeFileSync(
  path.join(__dirname, 'packed-manifest.json'),
  JSON.stringify(out, null, 1) + '\n'
)
console.log('wrote packed-manifest.json')
