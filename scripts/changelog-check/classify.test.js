'use strict'

/**
 * Table-driven tests for the changelog check.
 *
 * Cases marked BYPASS are defects an external review found in earlier revisions; they are
 * kept as regressions because each one shipped and passed a reading of the code.
 *
 * Run: node scripts/changelog-check/classify.test.js
 */

const assert = require('assert')
const { findMissing } = require('./classify')

const MANIFESTS = {
  'audio-studio': {},
  'audio-ui': {},
  'moonshine.rn': {},
  'react-native-essentia': {},
  'sherpa-onnx.rn': {},
  'expo-audio-stream': {},
  'expo-audio-studio': {},
  'agentic-dev': { private: true },
  playgroundapi: { private: true },
}
const ALL = Object.keys(MANIFESTS)

function run({
  changed,
  basePackages = ALL,
  headPackages = ALL,
  base = MANIFESTS,
  head = base,
  changelogUpdated = () => true,
}) {
  return findMissing({
    changed,
    basePackages,
    headPackages,
    baseManifest: (p) => base[p],
    headManifest: (p) => head[p],
    changelogUpdated,
  }).map((m) => m.pkg)
}

const CL = 'packages/audio-studio/CHANGELOG.md'

const cases = [
  ['source change without a changelog', { changed: ['packages/audio-studio/src/x.ts'] }, ['audio-studio']],
  ['source change with a changelog', { changed: ['packages/audio-studio/src/x.ts', CL] }, []],
  ['app-only change', { changed: ['apps/playground/src/App.tsx'] }, []],
  ['private package is out of scope', { changed: ['packages/agentic-dev/src/x.ts'] }, []],
  ['two packages, one changelog', {
    changed: ['packages/audio-ui/src/a.ts', 'packages/moonshine.rn/src/b.ts', 'packages/audio-ui/CHANGELOG.md'],
  }, ['moonshine.rn']],

  // Fail-closed: tests and native sources are enforced, because guessing which ones ship
  // was wrong in both directions.
  ['a test file is enforced', { changed: ['packages/audio-studio/src/foo.test.ts'] }, ['audio-studio']],
  ['an androidTest source is enforced', { changed: ['packages/sherpa-onnx.rn/android/src/androidTest/X.kt'] }, ['sherpa-onnx.rn']],
  ['a build config is enforced', { changed: ['packages/audio-studio/tsconfig.cjs.json'] }, ['audio-studio']],
  ['a native build script is enforced', { changed: ['packages/sherpa-onnx.rn/android/scripts/copy-libs.sh'] }, ['sherpa-onnx.rn']],
  ['package.json is enforced', { changed: ['packages/audio-studio/package.json'] }, ['audio-studio']],

  // Allowlisted: provably cannot reach a consumer.
  ['README is ignored', { changed: ['packages/audio-studio/README.md'] }, []],
  ['eslintrc is ignored', { changed: ['packages/audio-studio/.eslintrc.js'] }, []],
  ['root jest.config is ignored', { changed: ['packages/audio-studio/jest.config.js'] }, []],
  ['tsconfig.eslint is ignored', { changed: ['packages/audio-ui/tsconfig.eslint.json'] }, []],
  ['CONTRIBUTE.md is ignored', { changed: ['packages/audio-studio/CONTRIBUTE.md'] }, []],
  // third_party is NOT exempt: the build scripts compile these gitlinks into the shipped
  // native artifacts, so bumping one changes what consumers receive.
  ['a third_party gitlink bump is enforced', { changed: ['packages/sherpa-onnx.rn/third_party/sherpa-onnx'] }, ['sherpa-onnx.rn']],
  ['a moonshine third_party bump is enforced', { changed: ['packages/moonshine.rn/third_party/moonshine'] }, ['moonshine.rn']],

  // Bypasses found in review.
  ['BYPASS: changelog touched but gained no entry', {
    changed: ['packages/audio-studio/src/x.ts', CL],
    changelogUpdated: () => false,
  }, ['audio-studio']],
  ['BYPASS: flip private -> public and add source', {
    changed: ['packages/agentic-dev/src/x.ts'],
    head: { ...MANIFESTS, 'agentic-dev': {} },
  }, ['agentic-dev']],
  ['BYPASS: mark a package private while changing source', {
    changed: ['packages/audio-ui/src/x.ts'],
    head: { ...MANIFESTS, 'audio-ui': { private: true } },
  }, ['audio-ui']],
  ['BYPASS: add a brand new published package', {
    changed: ['packages/newthing/src/x.ts'],
    headPackages: [...ALL, 'newthing'],
    head: { ...MANIFESTS, newthing: {} },
  }, ['newthing']],
  ['BYPASS: unparseable manifest at base is enforced', {
    changed: ['packages/audio-ui/src/x.ts'],
    base: { ...MANIFESTS, 'audio-ui': null },
  }, ['audio-ui']],
  ['BYPASS: shim source redirects to audio-studio', {
    changed: ['packages/expo-audio-stream/src/index.ts'],
  }, ['expo-audio-stream']],
  ['shim source with audio-studio changelog passes', {
    changed: ['packages/expo-audio-stream/src/index.ts', CL],
  }, []],
]

let failed = 0
for (const [name, input, expected] of cases) {
  const got = run(input)
  const ok = JSON.stringify(got) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  -> [${got}] expected [${expected}]`)
}

console.log(failed ? `\n${failed} of ${cases.length} FAILED` : `\nall ${cases.length} pass`)
assert.strictEqual(failed, 0, `${failed} changelog-check cases failed`)
