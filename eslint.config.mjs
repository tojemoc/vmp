import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const sharedRules = {
  'no-console': 'warn',
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
  ],
  'simple-import-sort/imports': 'error',
  'simple-import-sort/exports': 'error',
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/coverage/**',
      '**/.wrangler/**',
      '**/migrations/**',
      'packages/web/public/**',
      'packages/media-pipeline/bin/**',
      'eslint.config.mjs',
      'prettier.config.mjs',
      'knip.json',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/base'],
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: sharedRules,
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    files: ['packages/api/**/*.ts', 'packages/api/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.worker,
      },
    },
  },
  {
    files: [
      'packages/offloading/**/*.ts',
      'packages/offloading/**/*.js',
      'packages/media-pipeline/**/*.ts',
      'packages/media-pipeline/**/*.js',
      'packages/web/scripts/**/*.ts',
      'packages/web/scripts/**/*.js',
      'packages/web/scripts/**/*.mjs',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: [
      'packages/web/**/*.ts',
      'packages/web/**/*.vue',
      'packages/web/**/*.js',
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
);
