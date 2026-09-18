/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Inlined at build time from package.json's version — see vite.config.ts. */
declare const __APP_VERSION__: string;
