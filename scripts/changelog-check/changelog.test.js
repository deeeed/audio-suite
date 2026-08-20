'use strict'

/**
 * Tests for the Unreleased-section parser.
 *
 * The inline version of this logic shipped a real bug: `\Z` is not a JavaScript escape, so
 * it matched a literal capital "Z" and truncated a section at the first Z in its text,
 * while a final Unreleased section never parsed at all. That is exactly the kind of thing
 * a regex buried in YAML hides.
 *
 * Run: node scripts/changelog-check/changelog.test.js
 */

const assert = require('assert')
const { unreleasedSection, entryText } = require('./changelog')

const base = '# CL\n\n## [Unreleased]\n\n## [1.0.0]\n\n### Fixed\n\n- old\n'
const gained = (head) =>
  entryText(unreleasedSection(head)).length > entryText(unreleasedSection(base)).length

const cases = [
  ['real entry counts', base.replace('## [Unreleased]\n', '## [Unreleased]\n\n### Fixed\n\n- new thing\n'), true],
  ['lone period does not', base.replace('## [Unreleased]\n', '## [Unreleased]\n\n.\n'), false],
  ['HTML comment does not', base.replace('## [Unreleased]\n', '## [Unreleased]\n\n<!-- nothing -->\n'), false],
  ['bare sub-heading does not', base.replace('## [Unreleased]\n', '## [Unreleased]\n\n### Fixed\n'), false],
  ['whitespace after an old release does not', base.replace('- old\n', '- old\n\n'), false],
  ['editing an old section does not', base.replace('- old', '- old edited'), false],
  ['blank lines do not', base.replace('## [Unreleased]\n', '## [Unreleased]\n\n\n\n'), false],
]

let failed = 0
for (const [name, head, expected] of cases) {
  const got = gained(head)
  const ok = got === expected
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}

// Regression for the `\Z` bug: a final Unreleased section whose text contains a capital Z.
const finalSection = '# CL\n\n## [1.0.0]\n\n- old\n\n## [Unreleased]\n\n- Zebra fix\n'
const parsedFinal = unreleasedSection(finalSection).includes('Zebra fix')
if (!parsedFinal) failed++
console.log(`${parsedFinal ? 'PASS' : 'FAIL'}  final Unreleased section containing a capital Z parses whole`)

const crlf = '# CL\r\n\r\n## [Unreleased]\r\n\r\n- crlf entry\r\n'
const parsedCrlf = entryText(unreleasedSection(crlf)).includes('crlf entry')
if (!parsedCrlf) failed++
console.log(`${parsedCrlf ? 'PASS' : 'FAIL'}  CRLF line endings parse`)

const noHeading = unreleasedSection('# CL\n\n## [1.0.0]\n\n- old\n') === ''
if (!noHeading) failed++
console.log(`${noHeading ? 'PASS' : 'FAIL'}  a changelog with no Unreleased heading yields an empty section`)

console.log(failed ? `\n${failed} FAILED` : `\nall ${cases.length + 3} pass`)
assert.strictEqual(failed, 0, `${failed} changelog parser cases failed`)
