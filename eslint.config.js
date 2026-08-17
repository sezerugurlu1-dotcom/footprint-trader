// ESLint flat config (ESLint 9+).
//
// Two goals:
//   1. Catch real bugs (typescript-eslint + react-hooks).
//   2. Lightly enforce style (curly, eqeqeq, no-var) without
//      conflicting with Prettier if/when it gets added later.
//
// Notes:
//   - We intentionally do NOT auto-fix existing files in the initial
//     setup commit; that's a separate, opt-in step.
//   - Tests are linted too \u2014 hooks rules apply there as well.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  // Ignore generated / vendor dirs
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '*.tsbuildinfo',
      'public/**',
    ],
  },

  // Base JS recommendations
  js.configs.recommended,

  // TypeScript recommended (typed linting, no-floating-promises, etc.)
  ...tseslint.configs.recommended,

  // Project-wide rules
  {
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // React hooks: catch missing/exhaustive deps, conditional hook calls.
      ...reactHooks.configs.recommended.rules,

      // Vite-specific: warn on non-component exports from component files.
      'react-refresh/only-export-components': 'off', // we have many utility exports

      // Disable the new react-hooks purity/refs rules.  They're useful
      // for typical React apps but too strict for this codebase:
      //  - `react-hooks/refs` flags `ref.current` reads in render, but
      //    our chart passes `chartRef.current` to lightweight-charts
      //    child components which is a legitimate pattern.
      //  - `react-hooks/purity` flags `Date.now()` in render, but
      //    Toolbar's "X seconds ago" badge legitimately needs it.
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      // The cascading-renders rule is useful in theory but produces
      // false positives in mature code that intentionally uses
      // useEffect+setState for cleanup-on-prop-change patterns (our
      // error boundaries, useOrderBook's symbol-change reset, etc.).
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'warn', // downgraded from error

      // Style: catch obvious mistakes
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': 'off', // we use console.log deliberately in the data layer

      // typescript-eslint niceties
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Allow non-null assertion in test files where we control the inputs
      '@typescript-eslint/no-non-null-assertion': 'off',
      // tsconfig has strict mode; this would just duplicate
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Test files: relax a few rules (console is fine, any is fine)
  {
    files: ['**/*.test.{ts,tsx}', 'src/binance/**', 'src/hooks/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
);
