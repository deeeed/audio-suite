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

// Classify EVERY tracked path. An earlier version filtered third_party wholesale, which
// hid packages/react-native-essentia/cpp/third_party/nlohmann/json.hpp — a header that is
// packed and must stay enforced. Vendored checkouts that genuinely are not ours are
// exempted by name in the classifier, where the decision is visible.
const tracked = git('ls-files', '-z', 'packages/').split('\0').filter(Boolean)

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
if (tracked.length < 100) {
  console.log(`FAIL  corpus is suspiciously small (${tracked.length} paths)`)
  process.exitCode = 1
}
const check = (label, ok, detail) => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  -> ${detail}`}`)
}

// Test paths that are NOT packed must never require a changelog. Tests under src/ are
// excluded from this rule deliberately: `npm pack` on audio-studio ships 15 compiled test
// files under build/cjs/, so a src/*.test.ts change is consumer-visible and is enforced.
const testLike = enforced.filter(
  (f) =>
    !/^packages\/[^/]+\/src\//.test(f) &&
    /androidTest\/|\/src\/test\/|Tests?\/|__tests__|\.(test|spec)\.[jt]sx?$|\.stories\.|\.storybook\/|test_models\/|test-assets\//.test(f)
)
check('no unpacked test/storybook path is enforced', testLike.length === 0, testLike.slice(0, 5).join(' '))

// And the converse: a packed test source must be enforced, or the name-shaped rules have
// crept back over shipped code.
const packedTest = 'packages/audio-studio/src/errors/AudioStreamError.test.ts'
if (tracked.includes(packedTest)) {
  check(`enforced (packed test source): ${packedTest}`, enforces(packedTest), 'wrongly ignored')
}

// Named exceptions from review rounds two and three.
const mustBeIgnored = [
  'packages/sherpa-onnx.rn/ios-testing-info.sh',
  'packages/react-native-essentia/.babelrc',
  'packages/audio-studio/.eslintrc.js',
  'packages/audio-studio/.size-limit.json',
  'packages/audio-ui/.storybook/main.ts',
  'packages/audio-studio/docs/TESTING_STRATEGY.md',
  // The four exact exemptions added in review round four. Listed here so deleting or
  // renaming any of them fails this test instead of leaving a stale rule behind.
  'packages/audio-studio/scripts/run_tests.sh',
  'packages/audio-studio/scripts/README.md',
  'packages/moonshine.rn/scripts/test-ios-artifacts-script.mjs',
  'packages/audio-ui/src/INSTALL.md',
]
for (const f of mustBeIgnored) {
  // Require the fixture to exist. Skipping absent paths let a renamed or deleted file turn
  // a real assertion into a no-op.
  check(`fixture exists: ${f}`, tracked.includes(f), 'fixture missing — update this list')
  if (tracked.includes(f)) check(`ignored: ${f}`, !enforces(f), 'wrongly enforced')
}

// Things that genuinely shape published output must stay enforced.
const mustBeEnforced = [
  'packages/audio-studio/package.json',
  'packages/sherpa-onnx.rn/android/scripts/copy-libs.sh',
  'packages/audio-studio/tsconfig.cjs.json',
  'packages/react-native-essentia/cpp/third_party/nlohmann/json.hpp',
]
for (const f of mustBeEnforced) {
  check(`fixture exists: ${f}`, tracked.includes(f), 'fixture missing — update this list')
  if (tracked.includes(f)) check(`enforced: ${f}`, enforces(f), 'wrongly ignored')
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
