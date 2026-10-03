// Shared flat-config rules for every package in this monorepo that didn't
// already have its own lint setup (sync, worker, packages/protocol, harness,
// reports' server — see IMPROVEMENTS_TECH.md 3.3). bridge's backend/frontend
// and reports' client already have their own working configs; this is
// deliberately not forced onto them, to avoid risking lint breakage in
// packages that already pass.
//
// Each consuming package has its own independent install (this repo's
// products are deliberately not one npm/pnpm workspace — see CLAUDE.md), so
// each one still needs its own `eslint`/`typescript-eslint` devDependencies;
// this file only centralizes the actual rule choices, imported by a thin
// per-package `eslint.config.mjs` that adds that package's own
// `languageOptions.parserOptions.project` and `ignores`.
import tseslint from 'typescript-eslint';

export const baseConfig = tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      // Deliberate in this codebase: a handled-error branch commonly narrows
      // with `error instanceof Error ? error.message : String(error)` rather
      // than typing every catch clause — recommended's default here would
      // flag a pattern used throughout, not a real issue.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
