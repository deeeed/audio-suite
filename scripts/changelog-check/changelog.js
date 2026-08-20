'use strict'

/**
 * Does a changelog have a new entry under "## [Unreleased]"?
 *
 * Extracted from the workflow because the inline regex used `\Z` as an end-of-input
 * anchor. JavaScript has no such escape, so it matched a literal capital "Z" and truncated
 * sections at the first Z in their text.
 */

/** Body under the `## [Unreleased]` heading, up to the next `## ` heading or end of input. */
function unreleasedSection(text) {
  if (!text) return ''
  const normalized = String(text).replace(/\r\n/g, '\n')
  // `(?![\s\S])` is end-of-input; `\Z` does not exist in JS and `$` matches every line end.
  // `[^\S\n]` rather than `\s` so a heading cannot span lines.
  const m = normalized.match(
    /^##[^\S\n]*\[Unreleased\][^\n]*\n([\s\S]*?)(?=^##[^\S\n]|(?![\s\S]))/m
  )
  return m ? m[1] : ''
}

/** Lines in a section that read as entries: bullets with actual words in them. */
function entries(section) {
  if (!section) return []
  return String(section)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s/.test(l))
    .filter((l) => /\p{L}|\p{N}/u.test(l))
}

/**
 * True when head gained a bullet that base did not have.
 *
 * Compares the entries themselves rather than text length, so moving an existing bullet
 * from a released section into Unreleased does not count, and neither does editing one.
 */
function hasNewUnreleasedEntry(baseText, headText) {
  // Compare against every bullet anywhere in the base file, not just its Unreleased
  // section, so moving a released entry up into Unreleased does not read as new work.
  const before = new Set(entries(String(baseText || '').replace(/\r\n/g, '\n')))
  return entries(unreleasedSection(headText)).some((e) => !before.has(e))
}

module.exports = { unreleasedSection, entries, hasNewUnreleasedEntry }
