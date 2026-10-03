import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    // vite.config.ts pins the dev server to 5174, not Vite's own default
    // 5173 — this was pointed at the wrong port (see IMPROVEMENTS_TECH.md
    // 4.5: Cypress existed but was never actually run in CI), so every run
    // here would have connected to nothing at all.
    baseUrl: 'http://localhost:5174',
    supportFile: 'cypress/support/e2e.ts',
  },
});
