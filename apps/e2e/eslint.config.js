import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'node_modules',
    'playwright-report*',
    'test-results',
    'perf-results',
    'coverage',
  ]),
  {
    // Specs and utils run in Node (Playwright's test runner) but the
    // page.evaluate/addInitScript callbacks they pass in execute in the
    // browser, so both global sets have to be available.
    files: ['**/*.{ts,mjs}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      // Several mocks in utils/ implement a real browser API's method shape
      // (e.g. a mock VideoEncoder's encode(frame)) where the parameter exists
      // only to match the signature and is never read in the body. Matches
      // the argsIgnorePattern convention in apps/artist and apps/craft.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
])
