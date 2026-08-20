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
  ['a bullet hidden in an HTML comment does not', withUnreleased('\n<!--\n- fake entry\n-->\n'), false],
  ['a bullet hidden in an unterminated comment does not', withUnreleased('\n<!--\n- fake entry\n'), false],
  ['a bullet inside a fenced block does not', withUnreleased('\n```\n- fake entry\n```\n'), false],

  ['a released bullet copied up with a trailing period does not',
    withUnreleased('\n- old thing.\n'), true],
]

let failed = 0
for (const [name, head, expected] of cases) {
  const got = hasNewUnreleasedEntry(base, head)
  const ok = got === expected
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}

// Editing an existing Unreleased bullet is not new work. Needs its own base, since the
// shared one has an empty Unreleased section.
const editBase = '# CL\n\n## [Unreleased]\n\n- existing\n\n## [1.0.0]\n\n- old thing\n'
const editHead = editBase.replace('- existing', '- existing reworded')
const editOk = hasNewUnreleasedEntry(editBase, editHead) === false
if (!editOk) failed++
console.log(`${editOk ? 'PASS' : 'FAIL'}  editing an existing Unreleased bullet does not count`)

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

console.log(failed ? `\n${failed} FAILED` : `\nall ${cases.length + 4} pass`)
assert.strictEqual(failed, 0, `${failed} changelog cases failed`)
