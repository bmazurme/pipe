module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js', 'dist'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    // IMPROVEMENTS_TECH.md 2.7. Scoped to controllers only — a broader rule
    // blocking cross-module *entity* imports was considered and rejected:
    // ApiKey/Session/ClaudeCredential all @ManyToOne-relate to User, and
    // config/type-orm.config.ts registers every entity centrally, so that
    // version would false-positive on normal TypeORM relations rather than
    // catching real sprawl. A controller is never a module's intended
    // public surface (that's its service, exported via *.module.ts) — if
    // another module needs its behavior, it belongs on the service.
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['../*/*.controller', '../../*/*.controller'],
            message: 'Importing another module\'s controller directly crosses a module boundary — depend on its service (exported from the module\'s providers/exports) instead.',
          },
        ],
      },
    ],
  },
};
