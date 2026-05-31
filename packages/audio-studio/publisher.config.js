/** @type {import('@siteed/publisher').DeepPartial<import('@siteed/publisher').ReleaseConfig>} */
const config = {
    packageManager: 'yarn',
    changelogFile: 'CHANGELOG.md',
    conventionalCommits: false,
    changelogFormat: 'conventional',
    versionStrategy: 'independent',
    bumpStrategy: 'prompt',
    packValidation: {
        enabled: false,
        validateFiles: true,
        validateBuildArtifacts: true,
    },
    git: {
        tagPrefix: '',
        requireCleanWorkingDirectory: true,
        requireUpToDate: true,
        requireUpstreamTracking: true,
        commit: true,
        push: true,
        commitMessage:
            'chore(audio-studio): release @siteed/audio-studio@${version}',
        tag: true,
        allowedBranches: ['main', 'master'],
        remote: 'origin',
    },
    npm: {
        publish: true,
        registry: 'https://registry.npmjs.org',
        tag: 'latest',
        access: 'public',
    },
    hooks: {},
    updateDependenciesOnRelease: false,
    dependencyUpdateStrategy: 'none',
}

module.exports = config
