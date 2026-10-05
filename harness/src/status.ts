#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { main } from './cli.js';

export * from './bridgeLive.js';
export * from './collect.js';
export * from './deriveStatus.js';
export * from './gitlabLive.js';
export * from './render.js';
export * from './cli.js';

// Guards against running main() as a side effect of a test file importing
// this module for its exported pure functions — only run it when this file
// is actually the process entry point (`node dist/status.js ...`).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
