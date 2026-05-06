/**
 * @type {import('eslint').Linter.Config}
 */
module.exports = {
    root: true,
    env: {
        browser: true,
        es2021: true,
    },
    extends: [
        'universe/native',
        'universe/web',
        'plugin:promise/recommended',
        'plugin:react/recommended',
        'prettier',
        'plugin:storybook/recommended',
    ],
    ignorePatterns: ['build', 'node_modules', 'dist', 'coverage'],
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        // eslint-disable-next-line no-undef
        tsconfigRootDir: __dirname,
        project: './tsconfig.eslint.json',
    },
    plugins: ['@typescript-eslint', 'prettier', 'promise'],
    overrides: [
        {
            files: ['src/**/*.{ts,tsx}'],
            excludedFiles: ['src/**/*.stories.ts', 'src/**/*.stories.tsx'],
            rules: {
                'no-restricted-imports': [
                    'error',
                    {
                        paths: [
                            {
                                name: '@siteed/audio-studio',
                                message:
                                    '@siteed/audio-ui source must use local waveform contracts; keep @siteed/audio-studio imports in stories only.',
                            },
                        ],
                    },
                ],
            },
        },
    ],
    rules: {
        // suppress errors for missing 'import React' in files
        'react/react-in-jsx-scope': 'off',
        '@typescript-eslint/no-unused-vars': [
            'error',
            {
                args: 'all',
                argsIgnorePattern: '^_',
                caughtErrors: 'all',
                caughtErrorsIgnorePattern: '^_',
                destructuredArrayIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                ignoreRestSiblings: true,
            },
        ],
        'promise/catch-or-return': 'error',
        'promise/always-return': 'error',
        'promise/no-nesting': 'warn',
        'promise/no-promise-in-callback': 'warn',
        'promise/no-callback-in-promise': 'warn',
        'promise/no-new-statics': 'error',
        'promise/no-return-wrap': 'error',
        'promise/param-names': 'error',
        'promise/no-return-in-finally': 'warn',
    },
}
