import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// @gravity-ui/navigation ships no "exports" map, so Node resolves its `main`
// (the CommonJS build) and then chokes on the `.css` imports inside it. The
// browser build already picks `module`; point the test runner at the same ESM
// entry so Vite transforms those stylesheets instead of Node.
const navigationEsm = path.resolve(
  __dirname,
  '../../node_modules/@gravity-ui/navigation/build/esm/index.js',
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@gravity-ui\/navigation$/, replacement: navigationEsm }],
  },
  // vitest reads this file, not vite.config.ts, so __APP_VERSION__ needs
  // defining here too — AppLayout renders it unconditionally.
  define: {
    __APP_VERSION__: JSON.stringify('test'),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    server: {
      deps: {
        inline: [/@gravity-ui/],
      },
    },
  },
});
