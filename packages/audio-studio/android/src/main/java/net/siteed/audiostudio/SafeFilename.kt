package net.siteed.audiostudio

/**
 * Whether a caller-supplied filename is a single, safe path component.
 *
 * Filenames arrive from JS and get appended to a directory, so a separator makes the value
 * a path rather than a name — and a path can traverse out of the directory it was appended
 * to. `AudioTrimmer` does `File(context.filesDir, "$outputFileName.$extension")`, and
 * `File(parent, child)` resolves `..` the same way iOS does, so `../../../../tmp/pwned`
 * writes outside `filesDir` (#452).
 *
 * Mirrors `SafeFilename.swift`. Kept as two small files rather than shared through the
 * bridge because the rule is four lines and the platforms have no common place to put it;
 * if either changes, the other must too.
 *
 * Rejecting beats sanitising to the last component: silently writing somewhere other than
 * asked is how #423 stayed hidden.
 */
internal object SafeFilename {

    /** True when [name] is one path component that can be appended safely. */
    fun isValid(name: String): Boolean {
        if (name.isEmpty()) return false
        if (name.contains('/')) return false
        // Android runs on Linux, where a backslash is an ordinary filename character
        // rather than a separator, so it is not rejected here.
        if (name == "." || name == "..") return false
        // A NUL truncates the path at the C boundary, so what gets created is not what
        // was inspected.
        if (name.contains('\u0000')) return false
        return true
    }
}
