import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { loadConfig, findProject } from '../config.js';
import { log } from '../log.js';
import { CREDENTIALS_PATH, resolveFromRoot } from '../paths.js';
import type { Credentials, ProjectConfig, SyncConfig } from '../types.js';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  status: CheckStatus;
  message: string;
}

// Everything the checks touch on disk, injected so the checks stay pure.
export interface DoctorFs {
  exists: (filePath: string) => boolean;
  isDirectory: (filePath: string) => boolean;
  read: (filePath: string) => string;
}

export interface DoctorOptions {
  fs: DoctorFs;
  credentialsPath: string;
  resolveRef: (ref: string) => string;
}

const ok = (message: string): CheckResult => ({ status: 'ok', message });
const warn = (message: string): CheckResult => ({ status: 'warn', message });
const fail = (message: string): CheckResult => ({ status: 'fail', message });

function checkDictionary(project: ProjectConfig, options: DoctorOptions): CheckResult {
  const label = `${project.name}: dictionary`;
  if (!project.dictionary) return ok(`${label} not configured (content passes through unchanged)`);

  const file = options.resolveRef(project.dictionary);
  if (!options.fs.exists(file)) return fail(`${label} ${file} does not exist`);

  try {
    const parsed: unknown = JSON.parse(options.fs.read(file));
    if (parsed === null || typeof parsed !== 'object') {
      return fail(`${label} ${file} must be a JSON array of { key, value } or a { key: value } object`);
    }
  } catch {
    return fail(`${label} ${file} is not valid JSON`);
  }
  return ok(`${label} ${file} parses`);
}

function checkPem(project: ProjectConfig, field: 'publicKeyPath' | 'privateKeyPath', options: DoctorOptions) {
  const label = `${project.name}: ${field}`;
  const ref = project[field];
  if (!ref) return ok(`${label} not configured`);

  const file = options.resolveRef(ref);
  if (!options.fs.exists(file)) return fail(`${label} ${file} does not exist`);

  // Only the header line is looked at; the key material is never echoed.
  if (!/-----BEGIN [A-Z ]+-----/.test(options.fs.read(file))) {
    return fail(`${label} ${file} is not a PEM file`);
  }
  return ok(`${label} ${file} is PEM`);
}

function checkProject(project: ProjectConfig, options: DoctorOptions): CheckResult[] {
  const resolved = path.resolve(project.path);
  const { fs } = options;
  const pathCheck = !fs.exists(resolved)
    ? fail(`${project.name}: path ${resolved} does not exist`)
    : !fs.isDirectory(resolved)
      ? fail(`${project.name}: path ${resolved} is not a directory`)
      : ok(`${project.name}: path ${resolved} is a directory`);

  return [
    pathCheck,
    checkDictionary(project, options),
    checkPem(project, 'publicKeyPath', options),
    checkPem(project, 'privateKeyPath', options),
  ];
}

function checkGlobal(config: SyncConfig, options: DoctorOptions): CheckResult[] {
  const results: CheckResult[] = [];

  results.push(
    config.bridge?.apiUrl ? ok(`bridge.apiUrl is set (${config.bridge.apiUrl})`) : fail('bridge.apiUrl is not set'),
  );

  const { fs, credentialsPath } = options;
  let credentials: Partial<Credentials> | undefined;
  if (!fs.exists(credentialsPath)) {
    results.push(
      fail(`bridge credentials file ${credentialsPath} is missing — run "sync-cli login-api-key <key>" or "login"`),
    );
  } else {
    try {
      credentials = JSON.parse(fs.read(credentialsPath)) as Partial<Credentials>;
    } catch {
      results.push(fail(`bridge credentials file ${credentialsPath} is not valid JSON`));
    }
  }

  if (credentials) {
    results.push(
      credentials.apiKey || credentials.refreshToken
        ? ok('bridge credentials are present')
        : fail('bridge credentials file has neither an API key nor a refresh token'),
    );
    results.push(
      credentials.gitlabToken
        ? ok('GitLab token is present')
        : warn('GitLab token is missing — needed only for issue mode ("sync-cli login-gitlab <token>")'),
    );
  }

  return results;
}

export function runDoctorChecks(config: SyncConfig, options: DoctorOptions, projects?: ProjectConfig[]): CheckResult[] {
  const list = projects ?? config.projects;
  return [...list.flatMap((p) => checkProject(p, options)), ...checkGlobal(config, options)];
}

export function doctorCommand(name?: string): void {
  const config = loadConfig();
  const projects = name ? [findProject(config, name)] : config.projects;

  const results = runDoctorChecks(
    config,
    {
      fs: {
        exists: existsSync,
        isDirectory: (p) => statSync(p).isDirectory(),
        read: (p) => readFileSync(p, 'utf-8'),
      },
      credentialsPath: CREDENTIALS_PATH,
      resolveRef: resolveFromRoot,
    },
    projects,
  );

  if (projects.length === 0) log.warn('[warn] no projects tracked yet — nothing to check per project');
  for (const r of results) {
    const line = `[${r.status}] ${r.message}`;
    if (r.status === 'ok') log.info(line);
    else if (r.status === 'warn') log.warn(line);
    else log.error(line);
  }

  if (results.some((r) => r.status === 'fail')) process.exitCode = 1;
}
