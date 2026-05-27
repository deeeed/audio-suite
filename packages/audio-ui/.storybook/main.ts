// This file has been automatically migrated to valid ESM format by Storybook.
import { createRequire } from "node:module";
import * as path from 'path';
import { join, dirname } from 'path';
import type { StorybookConfig } from '@storybook/react-webpack5';
import type { Configuration as WebpackConfig } from 'webpack';
import webpack from 'webpack';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(new URL(import.meta.url).pathname);

const production = process.env.NODE_ENV === 'production';

/**
 * This function is used to resolve the absolute path of a package.
 * It is needed in projects that use Yarn PnP or are set up within a monorepo.
 */
function getAbsolutePath(value: string) {
    return dirname(require.resolve(join(value, 'package.json')))
}

/** @type { import('@storybook/react-webpack5').StorybookConfig } */
const config: StorybookConfig = {
    stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
    staticDirs: ['../assets/'],
    managerHead: (head) => `
        ${head}
        ${production ? '<base href="/audiolab/expo-audio-ui-storybook/" />' : ''}
    `,
    addons: [
        getAbsolutePath('@storybook/addon-webpack5-compiler-swc'),
        getAbsolutePath('@storybook/addon-links'),
        // getAbsolutePath('@storybook/addon-interactions'),
        // getAbsolutePath('storybook/actions'),
        {
            name: getAbsolutePath("@storybook/addon-react-native-web"),
            options: {
                modulesToTranspile: ['react-native-reanimated', '@gorhom/bottom-sheet'],
                babelPlugins: [
                '@babel/plugin-proposal-export-namespace-from',
                ],
            },
        }
    ],
    framework: {
        name: getAbsolutePath('@storybook/react-webpack5'),
        options: {},
    },
    webpackFinal: async (config: WebpackConfig) => {
        // Fix for canvaskit-wasm trying to import Node.js modules
        config.resolve = {
            ...config.resolve,
            fallback: {
                ...config.resolve?.fallback,
                fs: false,
                path: false,
            },
            alias: {
                ...config.resolve?.alias,
                // Ensure we're using the same React instance
                'react': path.resolve(__dirname, '../node_modules/react'),
                'react-dom': path.resolve(__dirname, '../node_modules/react-dom'),
                // Add react-native-web alias
                'react-native$': 'react-native-web',
            },
        };
        
        // Add DefinePlugin to define Expo environment variables
        config.plugins = config.plugins || [];
        config.plugins.push(
            new webpack.DefinePlugin({
                'process.env.EXPO_OS': JSON.stringify('web'),
                '__DEV__': JSON.stringify(!production),
            })
        );
        
        return config;
    },
}
export default config
