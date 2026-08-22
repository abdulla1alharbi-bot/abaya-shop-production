import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // A leading underscore is how this codebase marks a binding that exists only
      // to be destructured away (`const { kind: _k, ...rest } = line`).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // shadcn/ui primitives ship the component and its `cva` variant map from one
    // file by design, and both are imported across the app. Fast Refresh loses
    // component state in these files when they are edited — an acceptable trade
    // for leaf primitives that rarely change.
    files: ['src/components/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': [
        'error',
        { allowConstantExport: true, allowExportNames: ['badgeVariants', 'buttonVariants'] },
      ],
    },
  },
])
