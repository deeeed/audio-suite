import fs from 'node:fs'
import path from 'node:path'

function canonicalDirectory(directory) {
    const resolved = fs.realpathSync(path.resolve(directory))
    if (!fs.statSync(resolved).isDirectory()) {
        throw new TypeError(`Allowed root is not a directory: ${resolved}`)
    }
    return resolved
}

export function benchmarkAllowedRoots(repoRoot, extraRoots = []) {
    const configured = String(process.env.BENCHMARK_ALLOWED_ROOTS || '')
        .split(path.delimiter)
        .filter(Boolean)
    return [...new Set([repoRoot, ...extraRoots, ...configured])]
        .filter((root) => fs.existsSync(root))
        .map(canonicalDirectory)
}

function isWithin(candidate, root) {
    const relative = path.relative(root, candidate)
    return (
        relative === '' ||
        (!relative.startsWith('..') && !path.isAbsolute(relative))
    )
}

function requireAllowed(candidate, roots) {
    if (
        !roots.some((root) =>
            isWithin(candidate, fs.realpathSync(path.resolve(root)))
        )
    ) {
        throw new Error(
            `Path is outside benchmark roots: ${candidate}. ` +
                'Set BENCHMARK_ALLOWED_ROOTS to an explicit trusted directory.'
        )
    }
    return candidate
}

export function resolveAllowedExistingPath(candidate, roots, kind = 'any') {
    const resolved = fs.realpathSync(path.resolve(candidate))
    requireAllowed(resolved, roots)
    const stat = fs.statSync(resolved) // NOSONAR: canonical path passed requireAllowed containment.
    if (kind === 'file' && !stat.isFile()) {
        throw new TypeError(`Expected a file: ${resolved}`)
    }
    if (kind === 'directory' && !stat.isDirectory()) {
        throw new TypeError(`Expected a directory: ${resolved}`)
    }
    return resolved
}

export function resolveAllowedOutputPath(candidate, roots) {
    const resolved = path.resolve(candidate)
    const parent = fs.realpathSync(path.dirname(resolved))
    requireAllowed(parent, roots)
    return path.join(parent, path.basename(resolved))
}

export function resolveAllowedDirectoryPath(candidate, roots) {
    const resolved = path.resolve(candidate)
    let ancestor = resolved
    while (!fs.existsSync(ancestor)) {
        const parent = path.dirname(ancestor)
        if (parent === ancestor) break
        ancestor = parent
    }
    const canonicalAncestor = fs.realpathSync(ancestor)
    requireAllowed(canonicalAncestor, roots)
    return resolved
}
