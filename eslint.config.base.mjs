// Shared flat-config rules for every package in this monorepo that didn't
// already have its own lint setup (sync, worker, packages/protocol, harness,
// reports' server — see IMPROVEMENTS_TECH.md 3.3). bridge's backend/frontend
// and reports' client already have their own working configs; this is
// deliberately not forced onto them, to avoid risking lint breakage in
// packages that already pass.
//
// packages/protocol, harness, sync, and worker are real root workspace
// members now (IMPROVEMENTS_TECH.md 5.1) and resolve their own declared
// `eslint`/`typescript-eslint` devDependencies through the root's single,
// hoisted `npm install` instead of each needing a separate one — reports'
// server is still its own independent install and keeps its own copies of
// both for that reason. Every consumer still needs its own thin
// per-package `eslint.config.mjs` importing this file, since each adds its
// own `languageOptions.parserOptions.project` and `ignores` — this file
// only centralizes the actual rule choices.
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
