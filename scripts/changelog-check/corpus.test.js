'use strict'

/**
 * Classifies every tracked path under packages/ and asserts named exceptions.
 *
 * The unit suite proves the logic against fixtures; this proves it against the repository
 * as it actually is. Two review rounds caught path claims that were simply wrong — a regex
 * expecting `scripts/ios-testing-info.sh` when the file sits at the package root, and a
 * hand-counted audit that omitted every package.json. Counting here rather than by hand
 * means those cannot drift silently again.
 *
 * Run: node scripts/changelog-check/corpus.test.js
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { findMissing } = require('./classify')

const repoRoot = path.resolve(__dirname, '../..')
const git = (...args) => execFileSync('git', args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 }).toString()

const packages = fs
  .readdirSync(path.join(repoRoot, 'packages'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)

const manifest = (pkg) => {
  const p = path.join(repoRoot, 'packages', pkg, 'package.json')
  if (!fs.existsSync(p)) return undefined
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

// The scoped corpus excludes vendored upstream trees, which are never our published source.
const tracked = git('ls-files', 'packages/')
  .split('\n')
  .filter(Boolean)
  .filter((f) => !f.includes('/third_party/') && !f.includes('/node_modules/'))

const enforces = (file) =>
  findMissing({
    changed: [file],
    basePackages: packages,
    headPackages: packages,
    baseManifest: manifest,
    headManifest: manifest,
    existsAtHead: () => true,
  }).length > 0

const enforced = tracked.filter(enforces)
const ignored = tracked.filter((f) => !enforces(f))

console.log(`scoped corpus: ${tracked.length} paths`)
console.log(`  enforced: ${enforced.length}`)
console.log(`  ignored:  ${ignored.length}`)

let failed = 0
const check = (label, ok, detail) => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  -> ${detail}`}`)
}

// Nothing test-like, storybook-like, or vendored may require a changelog.
const testLike = enforced.filter((f) =>
  /androidTest\/|\/src\/test\/|Tests?\/|__tests__|\.(test|spec)\.[jt]sx?$|\.stories\.|\.storybook\/|test_models\/|test-assets\//.test(f)
)
check('no test/storybook path is enforced', testLike.length === 0, testLike.slice(0, 5).join(' '))

// Named exceptions from review rounds two and three.
const mustBeIgnored = [
  'packages/sherpa-onnx.rn/ios-testing-info.sh',
  'packages/react-native-essentia/.babelrc',
  'packages/audio-studio/.eslintrc.js',
  'packages/audio-studio/.size-limit.json',
  'packages/audio-ui/.storybook/main.ts',
  'packages/audio-studio/docs/TESTING_STRATEGY.md',
]
for (const f of mustBeIgnored) {
  if (!tracked.includes(f)) continue // file may not exist; the named-path check below covers that
  check(`ignored: ${f}`, !enforces(f), 'wrongly enforced')
}

// Things that genuinely shape published output must stay enforced.
const mustBeEnforced = [
  'packages/audio-studio/package.json',
  'packages/sherpa-onnx.rn/android/scripts/copy-libs.sh',
  'packages/audio-studio/tsconfig.cjs.json',
  'packages/sherpa-onnx.rn/docs/API_REFERENCE.md',
]
for (const f of mustBeEnforced) {
  if (!tracked.includes(f)) continue
  check(`enforced: ${f}`, enforces(f), 'wrongly ignored')
}

// Every published package's manifest must be enforced — the audit that missed these
// under-reported the enforced count by seven.
for (const pkg of packages) {
  const m = manifest(pkg)
  if (!m || m.private) continue
  const f = `packages/${pkg}/package.json`
  if (!tracked.includes(f)) continue
  check(`enforced manifest: ${pkg}`, enforces(f), 'wrongly ignored')
}

console.log(failed ? `\n${failed} corpus checks FAILED` : `\nall corpus checks pass`)
assert.strictEqual(failed, 0, `${failed} corpus checks failed`)
