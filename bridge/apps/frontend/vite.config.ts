import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version: string };

export default defineConfig({
  plugins: [react()],
  // Inlined at build time so the sidebar can show which version is actually
  // deployed without a runtime API call — same idea as VITE_API_URL.
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 5173,
  },
});
