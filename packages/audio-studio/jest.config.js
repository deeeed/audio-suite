module.exports = {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/build/'],
  transform: {
    '^.+\\.tsx?$': [
      require.resolve('ts-jest'),
      {
        tsconfig: {
          target: 'ES2020',
          module: 'commonjs',
          esModuleInterop: true,
          jsx: 'react',
          skipLibCheck: true,
        },
        diagnostics: false,
      },
    ],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
}
