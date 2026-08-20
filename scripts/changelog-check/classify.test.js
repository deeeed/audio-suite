'use strict'

/**
 * Table-driven tests for the changelog check.
 *
 * Every case marked BYPASS or FALSE-FAILURE below is a defect an external review found
 * in a previous revision. They are kept as regressions rather than deleted, because each
 * one shipped at some point and passed a reading of the code.
 *
 * Run: node scripts/changelog-check/classify.test.js
 */

const assert = require('assert')
const { findMissing } = require('./classify')

const MANIFESTS = {
  playgroundapi: { private: true },
  'audio-studio': { files: ['src', 'android', 'ios'] },
  'audio-ui': { files: ['src', 'lib'] },
  'moonshine.rn': { files: ['src', 'lib', 'android', 'ios'] },
  'react-native-essentia': { files: ['src', 'android', 'ios'] },
  'sherpa-onnx.rn': { files: ['src', 'android', 'ios', 'docs'] },
  'expo-audio-stream': { files: ['src'] },
  'expo-audio-studio': { files: ['index.js'] },
  'agentic-dev': { private: true },
}

const ALL = Object.keys(MANIFESTS)

/** Builds a scenario with sensible defaults; override only what the case is about. */
function run({
  changed,
  basePackages = ALL,
  headPackages = ALL,
  base = MANIFESTS,
  head = base,
  deletedAtHead = [],
}) {
  return findMissing({
    changed,
    basePackages,
    headPackages,
    baseManifest: (p) => base[p],
    headManifest: (p) => head[p],
    existsAtHead: (path) => !deletedAtHead.includes(path),
  }).map((m) => m.pkg)
}

const cases = [
  // --- core behaviour ---
  ['source change without changelog', { changed: ['packages/audio-studio/src/x.ts'] }, ['audio-studio']],
  ['source change with changelog', { changed: ['packages/audio-studio/src/x.ts', 'packages/audio-studio/CHANGELOG.md'] }, []],
  ['no package touched', { changed: ['apps/playground/src/App.tsx'] }, []],
  ['two packages, one changelog', { changed: ['packages/audio-ui/src/a.ts', 'packages/moonshine.rn/src/b.ts', 'packages/audio-ui/CHANGELOG.md'] }, ['moonshine.rn']],
  ['deleting source still requires an entry', { changed: ['packages/audio-ui/src/gone.ts'] }, ['audio-ui']],

  // --- BYPASS regressions (each shipped at some point) ---
  ['BYPASS: delete the changelog while changing source', {
    changed: ['packages/audio-studio/src/x.ts', 'packages/audio-studio/CHANGELOG.md'],
    deletedAtHead: ['packages/audio-studio/CHANGELOG.md'],
  }, ['audio-studio']],
  ['BYPASS: flip private:true -> public and add source', {
    changed: ['packages/agentic-dev/src/x.ts'],
    head: { ...MANIFESTS, 'agentic-dev': { files: ['src'] } },
  }, ['agentic-dev']],
  ['BYPASS: add a brand new published package', {
    changed: ['packages/newthing/src/x.ts'],
    basePackages: ALL,
    headPackages: [...ALL, 'newthing'],
    head: { ...MANIFESTS, newthing: { files: ['src'] } },
  }, ['newthing']],
  ['BYPASS: mark a package private while changing its source', {
    changed: ['packages/audio-ui/src/x.ts'],
    head: { ...MANIFESTS, 'audio-ui': { private: true } },
  }, ['audio-ui']],
  ['BYPASS: unparseable manifest at base enforces', {
    changed: ['packages/audio-ui/src/x.ts'],
    base: { ...MANIFESTS, 'audio-ui': null },
  }, ['audio-ui']],
  ['BYPASS: shim source changes redirect to audio-studio', { changed: ['packages/expo-audio-stream/src/index.ts'] }, ['expo-audio-stream']],
  ['shim source with audio-studio changelog passes', {
    changed: ['packages/expo-audio-stream/src/index.ts', 'packages/audio-studio/CHANGELOG.md'],
  }, []],
  ['BYPASS: .npmignore changes tarball contents', { changed: ['packages/audio-studio/.npmignore'] }, ['audio-studio']],

  // --- FALSE-FAILURE regressions ---
  ['FALSE-FAILURE: android unit test', { changed: ['packages/audio-studio/android/src/test/java/X.kt'] }, []],
  ['FALSE-FAILURE: android instrumented test', { changed: ['packages/audio-studio/android/src/androidTest/java/X.kt'] }, []],
  ['FALSE-FAILURE: ios test dir', { changed: ['packages/audio-studio/ios/AudioStudioTests/X.swift'] }, []],
  ['FALSE-FAILURE: storybook', { changed: ['packages/audio-ui/.storybook/main.ts'] }, []],
  ['FALSE-FAILURE: story file', { changed: ['packages/audio-ui/src/Button.stories.tsx'] }, []],
  ['FALSE-FAILURE: Roboto assets', { changed: ['packages/audio-ui/assets/Roboto/Roboto-Regular.ttf'] }, []],
  ['FALSE-FAILURE: eslintrc', { changed: ['packages/audio-studio/.eslintrc.js'] }, []],
  ['FALSE-FAILURE: nested tsconfig.eslint', { changed: ['packages/audio-ui/tsconfig.eslint.json'] }, []],
  ['FALSE-FAILURE: size-limit', { changed: ['packages/audio-studio/.size-limit.json'] }, []],
  ['FALSE-FAILURE: run_tests.sh', { changed: ['packages/audio-studio/scripts/run_tests.sh'] }, []],
  ['FALSE-FAILURE: jest.setup', { changed: ['packages/audio-studio/jest.setup.js'] }, []],
  ['FALSE-FAILURE: contributor doc at package root', { changed: ['packages/audio-studio/CONTRIBUTE.md'] }, []],
  ['playgroundapi is private, so out of scope', {
    changed: ['packages/playgroundapi/src/x.ts'],
    base: { ...MANIFESTS, playgroundapi: { private: true } },
  }, []],
  ['BYPASS: playgroundapi flipped public must be enforced', {
    changed: ['packages/playgroundapi/src/x.ts'],
    base: { ...MANIFESTS, playgroundapi: { private: true } },
    head: { ...MANIFESTS, playgroundapi: { files: ['build'] } },
  }, ['playgroundapi']],
  ['FALSE-FAILURE: ios-testing-info.sh at package root', { changed: ['packages/sherpa-onnx.rn/ios-testing-info.sh'] }, []],
  ['FALSE-FAILURE: third_party eslintignore', { changed: ['packages/sherpa-onnx.rn/third_party/.eslintignore'] }, []],
  ['FALSE-FAILURE: babelrc', { changed: ['packages/react-native-essentia/.babelrc'] }, []],
  ['FALSE-FAILURE: test-ios-artifacts script', { changed: ['packages/moonshine.rn/scripts/test-ios-artifacts-script.mjs'] }, []],
  ['FALSE-FAILURE: scripts README', { changed: ['packages/audio-studio/scripts/README.md'] }, []],
  ['FALSE-FAILURE: src INSTALL doc', { changed: ['packages/audio-ui/src/INSTALL.md'] }, []],
  ['package.json changes are enforced', { changed: ['packages/audio-studio/package.json'] }, ['audio-studio']],

  // --- packed src/ lookalikes must NOT be exempted by name-shaped rules ---
  ['BYPASS: src/jest.config.ts is packed, so enforced', { changed: ['packages/audio-studio/src/jest.config.ts'] }, ['audio-studio']],
  // Real packed paths, verified against npm pack. audio-studio compiles src tests into
  // build/cjs/, so they ship; moonshine.rn ships none of its src/__tests__.
  ['BYPASS: packed src test is enforced', { changed: ['packages/audio-studio/src/errors/AudioStreamError.test.ts'] }, ['audio-studio']],
  ['unpacked src test stays ignored', { changed: ['packages/moonshine.rn/src/__tests__/MoonshineService.test.ts'] }, []],
  ['BYPASS: packed androidTest source is enforced', { changed: ['packages/sherpa-onnx.rn/android/src/androidTest/java/net/siteed/sherpaonnx/ArchitectureCompatibilityTest.kt'] }, ['sherpa-onnx.rn']],
  ['root jest.config.js is still ignored', { changed: ['packages/audio-studio/jest.config.js'] }, []],
  ['native tests are still ignored', { changed: ['packages/audio-studio/android/src/test/java/X.kt'] }, []],

  // --- docs asymmetry: only sherpa ships docs/ ---
  ['sherpa docs are shipped, so enforced', { changed: ['packages/sherpa-onnx.rn/docs/API.md'] }, ['sherpa-onnx.rn']],
  ['audio-studio docs are not shipped', { changed: ['packages/audio-studio/docs/TESTING.md'] }, []],

  // --- build inputs must stay enforced ---
  ['build tsconfig.cjs is enforced', { changed: ['packages/audio-studio/tsconfig.cjs.json'] }, ['audio-studio']],
  ['build tsconfig.build is enforced', { changed: ['packages/audio-ui/tsconfig.build.json'] }, ['audio-ui']],
  ['native build script is enforced', { changed: ['packages/sherpa-onnx.rn/android/scripts/copy-libs.sh'] }, ['sherpa-onnx.rn']],
]

let failed = 0
for (const [name, input, expected] of cases) {
  let got
  try {
    got = run(input)
  } catch (e) {
    console.log(`ERROR ${name}: ${e.message}`)
    failed++
    continue
  }
  const ok = JSON.stringify(got) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  -> [${got}] expected [${expected}]`)
}

console.log(failed ? `\n${failed} of ${cases.length} FAILED` : `\nall ${cases.length} pass`)
assert.strictEqual(failed, 0, `${failed} changelog-check cases failed`)
