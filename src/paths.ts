import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Everything sync-cli reads/writes lives next to the CLI itself (this repo),
// not in whatever directory the user happens to run it from.
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CONFIG_PATH = path.join(ROOT_DIR, 'sync.config.json');
export const CREDENTIALS_PATH = path.join(ROOT_DIR, '.sync-credentials.json');
export const STATE_PATH = path.join(ROOT_DIR, '.sync-state.json');
export const DICTIONARIES_DIR = path.join(ROOT_DIR, 'dictionaries');

export function resolveDictionaryPath(dictionaryRef: string): string {
  return path.isAbsolute(dictionaryRef)
    ? dictionaryRef
    : path.join(ROOT_DIR, dictionaryRef);
}
