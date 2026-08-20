'use strict'

/**
 * Decision logic for the changelog PR check.
 *
 * Lives here rather than inline in the workflow so it can be tested directly. Three
 * review rounds each found a different bypass in the embedded version; regex lists
 * buried in YAML are not something you can meaningfully verify by reading.
 *
 * Everything is pure: callers supply the base and head trees, and get back the list of
 * packages that changed without a changelog entry.
 */

/**
 * Paths that cannot change what a consumer of the published package receives.
 *
 * Deliberately NOT ignored, because they do shape published output:
 *   - tsconfig.cjs/esm/types/build.json and bob/rollup configs (compiler inputs)
 *   - android/scripts/*.sh (assemble the shipped native libraries)
 *   - .npmignore and .gitignore (decide tarball contents when `files` is absent)
 */
const IGNORED = [
  /^packages\/[^/]+\/CHANGELOG\.md$/,
  /^packages\/[^/]+\/README\.md$/,
  // Test suites — JS/TS and native.
  /^packages\/[^/]+\/.*__(tests|fixtures|mocks)__\//,
  /^packages\/[^/]+\/.*\.(test|spec)\.[jt]sx?$/,
  /^packages\/[^/]+\/android\/src\/(test|androidTest)\//,
  /^packages\/[^/]+\/ios\/[^/]*[Tt]ests?\//,
  /^packages\/[^/]+\/ios\/tests\//,
  /^packages\/[^/]+\/ios\/test_models\//,
  /^packages\/[^/]+\/e2e\//,
  /^packages\/[^/]+\/test-assets\//,
  /^packages\/[^/]+\/jest\.setup\.[jt]s$/,
  /^packages\/[^/]+\/\.size-limit\.json$/,
  /^packages\/[^/]+\/scripts\/(run_tests|ios-testing-info|validate-[^/]*)\.(sh|js|mjs)$/,
  // Storybook — dev-only, never built into published output.
  /^packages\/[^/]+\/\.storybook\//,
  /^packages\/[^/]+\/.*\.stories\.[jt]sx?$/,
  /^packages\/[^/]+\/assets\/Roboto\//,
  // Lint/editor config. NOT build config.
  /^packages\/[^/]+\/(.*\/)?\.(eslintrc|prettierrc|editorconfig)/,
  /^packages\/[^/]+\/(.*\/)?(jest|babel|metro)\.config\./,
  /^packages\/[^/]+\/(.*\/)?tsconfig\.(eslint|test|spec)\.json$/,
  /^packages\/[^/]+\/(.*\/)?tsconfig\.tsbuildinfo$/,
  // Contributor-facing docs at the package root that are not packed.
  /^packages\/[^/]+\/(ARCHITECTURE|CONTRIBUTE|CONTRIBUTING|PLAN|MIGRATION|TESTING)[^/]*\.md$/,
]

/** Packages that keep no changelog of their own; their changes are documented elsewhere. */
const REDIRECT = {
  'expo-audio-stream': 'audio-studio',
  'expo-audio-studio': 'audio-studio',
}

/** Packages that are neither published nor expected to keep a changelog. */
const EXEMPT = new Set(['playgroundapi'])

function shipsDocs(manifest) {
  if (!manifest) return true // unknown — enforce
  const files = manifest.files
  if (!Array.isArray(files)) return true // npm packs everything
  return files.some((f) => {
    const head = String(f).replace(/^\.\//, '').split('/')[0]
    return head === 'docs' || head === '.' || head === '*' || head === '**'
  })
}

/**
 * @param {object} input
 * @param {string[]} input.changed        paths changed between merge base and head
 * @param {string[]} input.basePackages   package dir names present at the merge base
 * @param {string[]} input.headPackages   package dir names present at head
 * @param {(pkg: string) => object|null|undefined} input.baseManifest  parsed package.json at base
 * @param {(pkg: string) => object|null|undefined} input.headManifest  parsed package.json at head
 * @param {(path: string) => boolean} input.existsAtHead  is this a regular file at head?
 * @returns {{pkg: string, owner: string, changelog: string, example: string, reason: string}[]}
 */
function findMissing(input) {
  const {
    changed,
    basePackages,
    headPackages,
    baseManifest,
    headManifest,
    existsAtHead,
  } = input

  const publishable = (manifest) => manifest !== null && manifest !== undefined && !manifest.private

  // Union of base-publishable and head-publishable. Base alone fails open when a PR adds
  // a package or flips private:true -> false; head alone fails open when a PR deletes a
  // package's manifest or marks it private while changing its source.
  const inScope = new Set()
  for (const pkg of basePackages) {
    if (EXEMPT.has(pkg)) continue
    const m = baseManifest(pkg)
    // A manifest that is unparseable at base is enforced rather than skipped.
    if (m === null || publishable(m)) inScope.add(pkg)
  }
  for (const pkg of headPackages) {
    if (EXEMPT.has(pkg)) continue
    const m = headManifest(pkg)
    if (m === null || publishable(m)) inScope.add(pkg)
  }

  const missing = []

  for (const pkg of [...inScope].sort()) {
    const prefix = `packages/${pkg}/`
    const manifest = headManifest(pkg) ?? baseManifest(pkg)
    const ignored = shipsDocs(manifest)
      ? IGNORED
      : [...IGNORED, /^packages\/[^/]+\/docs\//]

    const touched = changed.filter(
      (f) => f.startsWith(prefix) && !ignored.some((re) => re.test(f))
    )
    if (touched.length === 0) continue

    const owner = REDIRECT[pkg] || pkg
    const changelog = `packages/${owner}/CHANGELOG.md`

    // A path appearing in the diff only means it was touched — a deletion counts too.
    // Require an actual regular file at head, so deleting the changelog (or replacing it
    // with a symlink or directory) cannot pass as "updated".
    if (!changed.includes(changelog)) {
      missing.push({ pkg, owner, changelog, example: touched[0], reason: 'not updated' })
    } else if (!existsAtHead(changelog)) {
      missing.push({ pkg, owner, changelog, example: touched[0], reason: 'deleted or not a regular file' })
    }
  }

  return missing
}

module.exports = { findMissing, shipsDocs, IGNORED, REDIRECT, EXEMPT }
