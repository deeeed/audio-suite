'use strict'

/**
 * Parsing for the "## [Unreleased]" contract.
 *
 * Extracted from the workflow because the inline version shipped a real bug: it used `\Z`
 * as an end-of-input anchor, which JavaScript has no such escape for — it matched a
 * literal capital "Z", so a section was truncated at the first Z in its text and a final
 * Unreleased section never parsed at all. Inline regexes in YAML are not reviewable.
 */

/**
 * Returns the body under the `## [Unreleased]` heading, up to the next `## ` heading or
 * end of input. Empty string when there is no such heading.
 *
 * The lookahead uses `(?![\s\S])` for absolute end-of-input. `$` is unreliable here even
 * with /m (it matches at every line end), and `\Z` does not exist in JavaScript.
 */
function unreleasedSection(text) {
  if (!text) return ''
  const normalized = String(text).replace(/\r\n/g, '\n')
  // `[^\S\n]*` rather than `\s*` after "##": `\s` would consume newlines and accept a
  // heading split across lines.
  const m = normalized.match(
    /^##[^\S\n]*\[Unreleased\][^\n]*\n([\s\S]*?)(?=^##[^\S\n]|(?![\s\S]))/m
  )
  return m ? m[1] : ''
}

/**
 * The part of a section that reads as an actual entry.
 *
 * Drops blank lines, HTML comments, and lines that carry no letters or digits, so a lone
 * `.`, a comment, or reflowed whitespace cannot pass as documentation. Sub-headings such
 * as `### Fixed` are dropped too: a heading with nothing under it documents nothing.
 */
function entryText(section) {
  if (!section) return ''
  return String(section)
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^#{1,6}\s/.test(line))
    .filter((line) => /[A-Za-z0-9]/.test(line))
    .join('\n')
}

module.exports = { unreleasedSection, entryText }
