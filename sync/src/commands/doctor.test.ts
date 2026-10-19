import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { SyncConfig } from '../types.js';
import { runDoctorChecks, type DoctorOptions } from './doctor.js';

const PEM = '-----BEGIN PUBLIC KEY-----\nSECRETBODY\n-----END PUBLIC KEY-----\n';

function makeOptions(files: Record<string, string | null>): DoctorOptions {
  // null = a directory
  return {
    fs: {
      exists: (p) => p in files,
      isDirectory: (p) => files[p] === null,
      read: (p) => files[p] ?? '',
    },
    credentialsPath: '/cred.json',
    resolveRef: (ref) => ref,
  };
}

const goodFiles: Record<string, string | null> = {
  '/proj': null,
  '/dict.json': '{"A":"b"}',
  '/pub.pem': PEM,
  '/priv.pem': PEM.replace('PUBLIC', 'PRIVATE'),
  '/cred.json': JSON.stringify({ refreshToken: '', apiKey: 'sekret-key', gitlabToken: 'glpat-sekret' }),
};

const config = (): SyncConfig => ({
  bridge: { apiUrl: 'https://bridge.example' },
  projects: [
    { name: 'p', path: '/proj', dictionary: '/dict.json', publicKeyPath: '/pub.pem', privateKeyPath: '/priv.pem' },
  ],
});

const failures = (files: Record<string, string | null>, cfg = config()) =>
  runDoctorChecks(cfg, makeOptions(files))
    .filter((r) => r.status === 'fail')
    .map((r) => r.message);

describe('runDoctorChecks', () => {
  it('reports only ok lines for a fully valid config', () => {
    const results = runDoctorChecks(config(), makeOptions(goodFiles));
    assert.ok(results.length > 0);
    assert.ok(results.every((r) => r.status === 'ok'));
  });

  it('fails on a missing project path, naming project and path', () => {
    const { '/proj': _, ...files } = goodFiles;
    const [msg] = failures(files);
    assert.match(msg, /p: path \/proj does not exist/);
  });

  it('fails when the project path is a file', () => {
    const [msg] = failures({ ...goodFiles, '/proj': 'x' });
    assert.match(msg, /p: path \/proj is not a directory/);
  });

  it('fails on a missing dictionary', () => {
    const { '/dict.json': _, ...files } = goodFiles;
    assert.match(failures(files)[0], /p: dictionary \/dict\.json does not exist/);
  });

  it('fails on an unparsable dictionary', () => {
    assert.match(failures({ ...goodFiles, '/dict.json': '{nope' })[0], /p: dictionary \/dict\.json is not valid JSON/);
    assert.match(failures({ ...goodFiles, '/dict.json': '"str"' })[0], /must be a JSON array/);
  });

  it('fails on a missing or non-PEM key file', () => {
    const { '/pub.pem': _, ...files } = goodFiles;
    assert.match(failures(files)[0], /p: publicKeyPath \/pub\.pem does not exist/);
    assert.match(failures({ ...goodFiles, '/priv.pem': 'garbage' })[0], /p: privateKeyPath \/priv\.pem is not a PEM/);
  });

  it('fails on a missing bridge credentials file', () => {
    const { '/cred.json': _, ...files } = goodFiles;
    assert.match(failures(files)[0], /bridge credentials file \/cred\.json is missing/);
  });

  it('fails on credentials with neither apiKey nor refreshToken, and on invalid JSON', () => {
    assert.match(failures({ ...goodFiles, '/cred.json': '{"refreshToken":""}' })[0], /neither an API key/);
    assert.match(failures({ ...goodFiles, '/cred.json': '{' })[0], /not valid JSON/);
  });

  it('fails when bridge.apiUrl is empty', () => {
    const cfg = config();
    cfg.bridge.apiUrl = '';
    assert.match(failures(goodFiles, cfg)[0], /bridge\.apiUrl is not set/);
  });

  it('only warns about a missing GitLab token', () => {
    const files = { ...goodFiles, '/cred.json': '{"refreshToken":"r"}' };
    const results = runDoctorChecks(config(), makeOptions(files));
    assert.ok(results.every((r) => r.status !== 'fail'));
    assert.ok(results.some((r) => r.status === 'warn' && /GitLab token/.test(r.message)));
  });

  it('treats a project without dictionary/keys as ok', () => {
    const cfg: SyncConfig = { ...config(), projects: [{ name: 'q', path: '/proj' }] };
    assert.deepEqual(failures(goodFiles, cfg), []);
  });

  it('never includes token or key contents in messages', () => {
    const all = runDoctorChecks(config(), makeOptions(goodFiles)).map((r) => r.message).join('\n');
    assert.doesNotMatch(all, /sekret|SECRETBODY/);
  });
});
