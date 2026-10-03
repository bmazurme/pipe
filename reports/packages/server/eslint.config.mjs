import { baseConfig } from '../../../eslint.config.base.mjs';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  ...baseConfig,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
