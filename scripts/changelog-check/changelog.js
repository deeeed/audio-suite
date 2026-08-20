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

/** Strips content Markdown does not render as text: HTML comments and fenced code. */
function stripNonRendered(section) {
  return String(section)
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '') // unterminated comments too
    .replace(/^[^\S\n]*```[\s\S]*?(?:^[^\S\n]*```[^\n]*$|(?![\s\S]))/gm, '')
}

/** Lines in a section that read as entries: list items with actual words in them. */
function entries(section) {
  if (!section) return []
  return stripNonRendered(section)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(?:[-*+]|\d+\.)\s/.test(l))
    .filter((l) => /\p{L}|\p{N}/u.test(l))
}

/**
 * True when head gained a bullet that base did not have.
 *
 * Compares the entries themselves rather than text length, so moving an existing bullet
 * from a released section into Unreleased does not count, and neither does editing one.
 */
function hasNewUnreleasedEntry(baseText, headText) {
  const beforeAll = entries(String(baseText || '').replace(/\r\n/g, '\n'))
  const beforeUnreleased = entries(unreleasedSection(baseText))
  const afterUnreleased = entries(unreleasedSection(headText))

  // Require MORE distinct bullets under Unreleased than before. Counting duplicates would
  // let `- existing` be pasted twice; comparing text alone would let a reworded bullet
  // pass, since an edit produces a string the base did not contain.
  const distinctBefore = new Set(beforeUnreleased)
  const distinctAfter = new Set(afterUnreleased)
  if (distinctAfter.size <= distinctBefore.size) return false

  // And require at least one bullet that does not already exist anywhere in the base file,
  // so copying a released entry up into Unreleased does not read as new work.
  const seen = new Set(beforeAll)
  return [...distinctAfter].some((e) => !seen.has(e))
}

module.exports = { unreleasedSection, entries, stripNonRendered, hasNewUnreleasedEntry }
