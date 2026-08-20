'use strict'

/** Run: node scripts/changelog-check/changelog.test.js */

const assert = require('assert')
const { unreleasedSection, hasNewUnreleasedEntry } = require('./changelog')

const base = '# CL\n\n## [Unreleased]\n\n## [1.0.0]\n\n### Fixed\n\n- old thing\n'
const withUnreleased = (body) => base.replace('## [Unreleased]\n', `## [Unreleased]\n${body}`)

const cases = [
  ['a new bullet counts', withUnreleased('\n### Fixed\n\n- new thing\n'), true],
  ['a lone period does not', withUnreleased('\n.\n'), false],
  ['a bare sub-heading does not', withUnreleased('\n### Fixed\n'), false],
  ['an HTML comment does not', withUnreleased('\n<!-- nothing -->\n'), false],
  ['blank lines do not', withUnreleased('\n\n\n'), false],
  ['whitespace after an old release does not', base.replace('- old thing\n', '- old thing\n\n'), false],
  ['editing an old entry does not', base.replace('- old thing', '- old thing edited'), false],
  ['moving a released bullet into Unreleased does not', withUnreleased('\n- old thing\n'), false],
]

let failed = 0
for (const [name, head, expected] of cases) {
  const got = hasNewUnreleasedEntry(base, head)
  const ok = got === expected
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}

// `\Z` regression: a final Unreleased section whose text contains a capital Z.
const zCase = unreleasedSection('# CL\n\n## [1.0.0]\n\n- old\n\n## [Unreleased]\n\n- Zebra fix\n')
const zOk = zCase.includes('Zebra fix')
if (!zOk) failed++
console.log(`${zOk ? 'PASS' : 'FAIL'}  a final Unreleased section containing a capital Z parses whole`)

const crlfOk = hasNewUnreleasedEntry(base, '# CL\r\n\r\n## [Unreleased]\r\n\r\n- crlf entry\r\n')
if (!crlfOk) failed++
console.log(`${crlfOk ? 'PASS' : 'FAIL'}  CRLF line endings parse`)

const cjkOk = hasNewUnreleasedEntry(base, withUnreleased('\n- 修复音频\n'))
if (!cjkOk) failed++
console.log(`${cjkOk ? 'PASS' : 'FAIL'}  a non-ASCII entry counts`)

console.log(failed ? `\n${failed} FAILED` : `\nall ${cases.length + 3} pass`)
assert.strictEqual(failed, 0, `${failed} changelog cases failed`)
