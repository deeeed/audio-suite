'use strict'

/**
 * End-to-end test of the workflow's Git adapter against a real repository.
 *
 * The unit suites cover the decision logic, but the inline Git code in the workflow —
 * mode checks, NUL splitting, tree traversal — was never executed by any test. Review
 * found three bypasses living in exactly that layer (deleted changelogs counting as
 * updated, symlinks passing as regular files, chmod-only changes passing), so it gets
 * its own test built from real git objects rather than mocks.
 *
 * The script is extracted from the workflow YAML at run time, so this cannot drift from
 * what CI actually executes.
 *
 * Run: node scripts/changelog-check/workflow.test.js
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const repoRoot = path.resolve(__dirname, '../..')
const workflow = fs.readFileSync(
  path.join(repoRoot, '.github/workflows/changelog-check.yml'),
  'utf8'
)

const scriptBlock = workflow.match(/ {10}script: \|\n((?: {12}.*\n|\n)+)/)
assert(scriptBlock, 'could not find the inline script block in changelog-check.yml')
const inlineScript = scriptBlock[1]
  .split('\n')
  .map((l) => (l.startsWith(' '.repeat(12)) ? l.slice(12) : l))
  .join('\n')
  .replace(/process\.env\.GITHUB_WORKSPACE/g, 'process.env.WS')

const harness = `
const RESULT = { failed: null, info: null }
const core = {
  info: (m) => { RESULT.info = m },
  warning: () => {},
  setFailed: (m) => { RESULT.failed = m },
}
const context = {
  payload: {
    pull_request: {
      labels: JSON.parse(process.env.LABELS || '[]'),
      base: { sha: process.env.BASE },
      head: { sha: process.env.HEAD },
    },
  },
}
process.chdir(process.env.REPO)
async function run() {
${inlineScript.split('\n').map((l) => '  ' + l).join('\n')}
}
run().then(() => {
  console.log(RESULT.failed ? 'FAILED' : 'PASSED')
}).catch((e) => {
  console.log('ERROR: ' + e.message)
})
`

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'changelog-e2e-'))
const runnerPath = path.join(tmp, 'runner.js')
fs.writeFileSync(runnerPath, harness)

const repo = path.join(tmp, 'repo')
const git = (...args) => execFileSync('git', args, { cwd: repo }).toString().trim()

fs.mkdirSync(path.join(repo, 'packages/pkg/src'), { recursive: true })
execFileSync('git', ['init', '-q', repo])
git('config', 'user.email', 'test@example.com')
git('config', 'user.name', 'test')

const write = (rel, body) => fs.writeFileSync(path.join(repo, rel), body)
const commit = (msg) => {
  git('add', '-A')
  git('commit', '-q', '-m', msg)
  return git('rev-parse', 'HEAD')
}

const CLEAN = '# CL\n\n## [Unreleased]\n\n## [1.0.0]\n\n- old\n'
write('packages/pkg/package.json', '{"name":"@x/pkg"}\n')
write('packages/pkg/CHANGELOG.md', CLEAN)
write('packages/pkg/src/a.ts', 'export const a = 1\n')
const BASE = commit('base')

const at = (build) => {
  git('reset', '-q', '--hard', BASE)
  build()
  return commit('scenario')
}

const scenarios = [
  ['source change, no changelog', at(() => write('packages/pkg/src/a.ts', 'export const a = 2\n')), 'FAILED'],
  ['source change with a real entry', at(() => {
    write('packages/pkg/src/a.ts', 'export const a = 3\n')
    write('packages/pkg/CHANGELOG.md', '# CL\n\n## [Unreleased]\n\n- real entry\n\n## [1.0.0]\n\n- old\n')
  }), 'PASSED'],
  ['whitespace-only changelog edit', at(() => {
    write('packages/pkg/src/a.ts', 'export const a = 4\n')
    write('packages/pkg/CHANGELOG.md', CLEAN + '\n')
  }), 'FAILED'],
  ['changelog deleted', at(() => {
    write('packages/pkg/src/a.ts', 'export const a = 5\n')
    fs.unlinkSync(path.join(repo, 'packages/pkg/CHANGELOG.md'))
  }), 'FAILED'],
  ['changelog replaced by a symlink', at(() => {
    write('packages/pkg/src/a.ts', 'export const a = 6\n')
    fs.unlinkSync(path.join(repo, 'packages/pkg/CHANGELOG.md'))
    fs.symlinkSync('src/a.ts', path.join(repo, 'packages/pkg/CHANGELOG.md'))
  }), 'FAILED'],
  ['bullet hidden in an HTML comment', at(() => {
    write('packages/pkg/src/a.ts', 'export const a = 7\n')
    write('packages/pkg/CHANGELOG.md', '# CL\n\n## [Unreleased]\n\n<!--\n- fake\n-->\n\n## [1.0.0]\n\n- old\n')
  }), 'FAILED'],
  ['released bullet copied into Unreleased', at(() => {
    write('packages/pkg/src/a.ts', 'export const a = 8\n')
    write('packages/pkg/CHANGELOG.md', '# CL\n\n## [Unreleased]\n\n- old\n\n## [1.0.0]\n\n- old\n')
  }), 'FAILED'],
  ['docs-only change needs no entry', at(() => write('packages/pkg/README.md', 'hello\n')), 'PASSED'],
]

let failed = 0
for (const [name, head, expected] of scenarios) {
  const got = execFileSync('node', [runnerPath], {
    env: { ...process.env, WS: repoRoot, REPO: repo, BASE, HEAD: head },
  })
    .toString()
    .trim()
    .split('\n')
    .pop()
  const ok = got === expected
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} -> ${got} (expected ${expected})`)
}

// The escape hatch must work.
const labelled = execFileSync('node', [runnerPath], {
  env: {
    ...process.env,
    WS: repoRoot,
    REPO: repo,
    BASE,
    HEAD: scenarios[0][1],
    LABELS: '[{"name":"skip-changelog"}]',
  },
}).toString().trim().split('\n').pop()
const labelOk = labelled === 'PASSED'
if (!labelOk) failed++
console.log(`${labelOk ? 'PASS' : 'FAIL'}  skip-changelog label bypasses the check -> ${labelled}`)

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failed ? `\n${failed} FAILED` : `\nall ${scenarios.length + 1} pass`)
assert.strictEqual(failed, 0, `${failed} workflow scenarios failed`)
