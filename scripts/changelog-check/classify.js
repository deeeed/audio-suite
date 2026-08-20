'use strict'

/**
 * Decision logic for the changelog PR check.
 *
 * Deliberately simple and fail-closed: if a published package's tree changed at all, it
 * needs a changelog entry, unless the path is on a short explicit allowlist of things that
 * provably cannot reach a consumer.
 *
 * Earlier versions tried to be clever about what "cannot affect consumers" means, using
 * path conventions like `*.test.ts` and `androidTest/`. Review found that wrong in both
 * directions — audio-studio compiles its src tests into build/cjs/ and ships them,
 * sherpa-onnx.rn ships androidTest sources outright, moonshine.rn ships none — and the
 * attempt to fix it by snapshotting `npm pack` output recorded local build artifacts
 * rather than repository state.
 *
 * So the boundary is no longer inferred. Asking someone to add a changelog line for a test
 * edit costs them one line or a `skip-changelog` label; silently letting published source
 * through is the failure that actually matters.
 */

/**
 * Paths that cannot reach a consumer under any packaging arrangement.
 *
 * Every entry is an exact path or a directory that exists solely for repository tooling.
 * Anything requiring a judgement call about whether it ships is NOT here — it is enforced.
 */
const IGNORED = [
  // The changelog itself, and the file a reader would check instead.
  /^packages\/[^/]+\/CHANGELOG\.md$/,
  /^packages\/[^/]+\/README\.md$/,
  // Editor and lint configuration at the package root.
  /^packages\/[^/]+\/\.(eslintrc|eslintignore|prettierrc|prettierignore|editorconfig|babelrc)[^/]*$/,
  /^packages\/[^/]+\/(jest|babel|metro)\.config\.[^/]+$/,
  /^packages\/[^/]+\/tsconfig\.(eslint|test|spec)\.json$/,
  // Contributor-facing docs at the package root.
  /^packages\/[^/]+\/(ARCHITECTURE|CONTRIBUTE|CONTRIBUTING|PLAN|MIGRATION|TESTING)[^/]*\.md$/,
]

/** Packages that keep no changelog of their own; their changes are documented elsewhere. */
const REDIRECT = {
  'expo-audio-stream': 'audio-studio',
  'expo-audio-studio': 'audio-studio',
}

/**
 * @param {object} input
 * @param {string[]} input.changed        paths changed between merge base and head
 * @param {string[]} input.basePackages   package dir names present at the merge base
 * @param {string[]} input.headPackages   package dir names present at head
 * @param {(pkg: string) => object|null|undefined} input.baseManifest  parsed package.json at base
 * @param {(pkg: string) => object|null|undefined} input.headManifest  parsed package.json at head
 * @param {(path: string) => boolean} input.changelogUpdated  did this changelog gain an entry?
 * @returns {{pkg: string, owner: string, changelog: string, example: string, reason: string}[]}
 */
function findMissing(input) {
  const {
    changed,
    basePackages,
    headPackages,
    baseManifest,
    headManifest,
    changelogUpdated,
  } = input

  const publishable = (m) => m !== null && m !== undefined && !m.private

  // Union of base-publishable and head-publishable. Base alone fails open when a PR adds a
  // package or flips private:true -> false; head alone fails open when a PR deletes a
  // manifest or marks a package private while changing its source.
  const inScope = new Set()
  for (const pkg of basePackages) {
    const m = baseManifest(pkg)
    // Unparseable at base is enforced, not skipped.
    if (m === null || publishable(m)) inScope.add(pkg)
  }
  for (const pkg of headPackages) {
    const m = headManifest(pkg)
    if (m === null || publishable(m)) inScope.add(pkg)
  }

  const missing = []

  for (const pkg of [...inScope].sort()) {
    const prefix = `packages/${pkg}/`
    const touched = changed.filter(
      (f) => f.startsWith(prefix) && !IGNORED.some((re) => re.test(f))
    )
    if (touched.length === 0) continue

    const owner = REDIRECT[pkg] || pkg
    const changelog = `packages/${owner}/CHANGELOG.md`

    if (!changed.includes(changelog)) {
      missing.push({ pkg, owner, changelog, example: touched[0], reason: 'not updated' })
    } else if (!changelogUpdated(changelog)) {
      missing.push({
        pkg,
        owner,
        changelog,
        example: touched[0],
        reason: 'has no new entry under "## [Unreleased]"',
      })
    }
  }

  return missing
}

module.exports = { findMissing, IGNORED, REDIRECT }
