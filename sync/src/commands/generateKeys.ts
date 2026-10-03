import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { findProject, loadConfig } from '../config.js';
import { generateKeyPair } from '../encryption.js';
import { resolveFromRoot } from '../paths.js';
import { log } from '../log.js';

// Generates the RSA-4096 keypair push-issue/pull-issue expect at
// publicKeyPath/privateKeyPath — reports' Settings → Encryption page has its
// own "Generate key pair" button producing the same format (see
// reports/packages/server/src/subscription/config-props.ts
// generateAndSaveKeyPair -> encryption.ts generateKeyPair); this is the
// sync-cli-side equivalent so a keypair doesn't have to be hand-rolled with
// openssl just to enable encryption here.
export function generateKeysCommand(name: string, options: { force?: boolean }): void {
  const config = loadConfig();
  const project = findProject(config, name);

  if (!project.publicKeyPath || !project.privateKeyPath) {
    throw new Error(
      `Project "${name}" has no publicKeyPath/privateKeyPath in sync.config.json — add both first, ` +
        'e.g. "keys/<name>-public.pem" / "keys/<name>-private.pem".',
    );
  }

  const publicPath = resolveFromRoot(project.publicKeyPath);
  const privatePath = resolveFromRoot(project.privateKeyPath);

  if (!options.force && (existsSync(publicPath) || existsSync(privatePath))) {
    throw new Error(
      `A key already exists at ${publicPath} or ${privatePath} — pass --force to overwrite. ` +
        'Overwriting invalidates any parcel encrypted with the old key that hasn\'t been pulled yet.',
    );
  }

  const { publicKey, privateKey } = generateKeyPair();

  mkdirSync(path.dirname(publicPath), { recursive: true });
  mkdirSync(path.dirname(privatePath), { recursive: true });
  writeFileSync(publicPath, publicKey, { mode: 0o644 });
  writeFileSync(privatePath, privateKey, { mode: 0o600 });

  log.info(`Wrote ${publicPath} and ${privatePath}.`);
  log.info(
    'To exchange encrypted parcels with reports\' Subscription module, paste both PEM contents into ' +
      'Settings → Шифрование there (or vice versa: generate in reports and put its output at these paths).',
  );
}
