# Releasing

## @siteed/audio-studio

Run `yarn release` from `packages/audio-studio/`. The script will guide you through:
1. Lint + build
2. Version bump + npm publish (@siteed/audio-studio)
3. Documentation generation (optional)
4. Playground app deploy (optional)

## Shim policy
The `@siteed/expo-audio-studio` shim re-exports everything from `@siteed/audio-studio`.
It is deprecated on npm and should not be published by default.
Only publish a shim version when there is an explicit backwards-compatibility reason, and deprecate that version immediately with `npm deprecate`.

During a new `@siteed/audio-studio` major prerelease, keep both deprecated
wrappers pinned to the latest stable audio-studio version. This intentionally
leaves stable and prerelease audio-studio entries in the root lockfile. Do not
replace the shim pins with `workspace:^`: Yarn would pack that as a range which
also accepts the next stable major, silently moving compatibility-wrapper users
onto a breaking release.
