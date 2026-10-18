import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { resolveInDir } from '@pipe/protocol/resolveInDir';

import { issueKey, loadAgentState, recordOwnOutput } from '../agentState.js';
import { BridgeClient } from '../bridgeClient.js';
import { buildIssuePrompt, runClaude } from '../claudeRunner.js';
import { findProject, loadConfig, projectExclude, projectInclude } from '../config.js';
import { loadCredentialsOrEmpty } from '../credentials.js';
import { decryptBuffer, encryptBuffer } from '../encryption.js';
import { addTaskWorktree, commitAll, pushBranch, removeTaskWorktree } from '../gitWorktree.js';
import { buildIssueArchive, extractIssue, extractIssueArchive, updateIssueFile } from '../issuePack.js';
import { findOwnCredentials } from '../ownCredentials.js';
import { AGENT_WORK_DIR, resolveFromRoot } from '../paths.js';
import { contentHash, readAndTransform } from '../pack.js';
import { reviewIssueBeforeDispatch } from '../reviewPrompt.js';
import type { Credentials, ProjectConfig, StoredFileResponse } from '../types.js';
import { walkProjectFiles } from '../walk.js';
import { issueParcelName } from './pushIssue.js';
import { log } from '../log.js';

// iid is `\d+` for a real GitLab issue, but reports' manual parcels (no
// GitLab issue behind them — see reports/howto.md) use `m-<base36>`
// instead (e.g. "m-mup3r0x2") — `.+` covers both; `candidate.iid` is only
// ever threaded through as an opaque string from here on (branch/directory
// naming, issueKey), never parsed as a number, so this is safe to relax.
const PARCEL_NAME_PATTERN = /^(\d+)-(.+)\.subscription\.zip(\.enc)?$/;

interface Candidate {
  file: StoredFileResponse;
  projectId: string;
  iid: string;
  encrypted: boolean;
}

export function findCandidates(files: StoredFileResponse[], gitlabProjectId: string | undefined): Candidate[] {
  const matches: Candidate[] = [];

  for (const file of files) {
    const match = PARCEL_NAME_PATTERN.exec(file.originalName);
    if (!match) continue;

    const [, projectId, iid, encExt] = match;
    if (gitlabProjectId && gitlabProjectId !== projectId) continue;

    matches.push({ file, projectId, iid, encrypted: Boolean(encExt) });
  }

  // One candidate per issue: the newest parcel wins if somehow more than one
  // is sitting on bridge for the same issue (a prior poll that crashed
  // mid-processing, say) — older ones are simply left behind, same
  // known limitation as push/pull (see README "Ограничения текущей версии").
  const newestByIssue = new Map<string, Candidate>();
  for (const candidate of matches) {
    const key = issueKey(candidate.projectId, candidate.iid);
    const existing = newestByIssue.get(key);
    if (!existing || new Date(candidate.file.createdAt) > new Date(existing.file.createdAt)) {
      newestByIssue.set(key, candidate);
    }
  }

  return [...newestByIssue.values()];
}

// True when the worktree is clean. On a hit, logs the offending file names
// (never the values) and returns false so the caller skips commit/push/upload.
export async function resultIsFreeOfOwnCredentials(
  worktreeDir: string,
  project: ProjectConfig,
  credentials: Partial<Credentials>,
  key: string,
): Promise<boolean> {
  // Everything `git add -A` would commit (incl. dotfiles and non-code files)
  // plus everything the result parcel would contain.
  const gitFiles = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: worktreeDir,
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  const parcelFiles = await walkProjectFiles(worktreeDir, projectInclude(project), projectExclude(project));
  const relPaths = [...new Set([...gitFiles, ...parcelFiles])];
  const leaked = findOwnCredentials(worktreeDir, relPaths, credentials);
  if (leaked.length === 0) return true;

  log.error(
    `Aborting ${key}: the agent's result contains sync-cli's own stored credentials in: ${leaked.join(', ')}.\n` +
      `Nothing was committed, pushed or uploaded. The worktree was left in place for inspection: ${worktreeDir}`,
  );
  return false;
}

export async function processCandidate(
  candidate: Candidate,
  project: ProjectConfig,
  client: BridgeClient,
  review: boolean,
): Promise<void> {
  const key = issueKey(candidate.projectId, candidate.iid);
  const downloaded = await client.peek(candidate.file.id);

  let buffer = downloaded;
  if (candidate.encrypted) {
    if (!project.privateKeyPath) {
      log.error(`Skipping ${key}: "${candidate.file.originalName}" is encrypted, but no privateKeyPath is configured.`);
      return;
    }
    buffer = decryptBuffer(downloaded, readFileSync(resolveFromRoot(project.privateKeyPath), 'utf-8'));
  }

  const { manifest, files: packedFiles, assets, legacyManifest } = extractIssueArchive(buffer);

  if (legacyManifest) {
    log.error(`Skipping ${key}: parcel has no issue metadata (legacy manifest) — agent-runner needs a title/description to work from.`);
    return;
  }

  const state = loadAgentState();
  if (state[key]?.lastOwnOutputHash === manifest.contentHash) {
    log.info(`Skipping ${key}: this is agent-runner's own last result, not a new push.`);
    await client.delete(candidate.file.id);
    return;
  }

  const branch = manifest.branch || `task/${candidate.projectId}-${candidate.iid}`;
  const worktreeDir = path.join(AGENT_WORK_DIR, `${candidate.projectId}-${candidate.iid}`);

  // The parcel is untrusted: reject escaping entry names before touching disk.
  const destinations = packedFiles.map((file) => resolveInDir(worktreeDir, file.relPath));
  for (const asset of assets) resolveInDir(worktreeDir, asset.relPath);

  mkdirSync(AGENT_WORK_DIR, { recursive: true });
  if (existsSync(worktreeDir)) {
    log.info(`Removing a leftover worktree from a previous run at ${worktreeDir} before starting.`);
  }
  removeTaskWorktree(project.path, worktreeDir);
  rmSync(worktreeDir, { recursive: true, force: true });

  // No blanket try/finally cleanup here on purpose: an *unexpected* failure
  // (a git error, Claude's own crash, anything not already handled below)
  // leaves the worktree in place instead of deleting the only copy of
  // whatever work exists so far — cleanup only happens on the handled exit
  // paths (Claude ran and failed cleanly, or the whole thing succeeded).
  // Without this, e.g. an ENOBUFS from a huge git push loses the agent's
  // work with no way to recover it (see incident when this was a `finally`).
  addTaskWorktree(project.path, worktreeDir, branch, project.baseBranch ?? 'main');

  packedFiles.forEach((file, i) => {
    mkdirSync(path.dirname(destinations[i]), { recursive: true });
    writeFileSync(destinations[i], file.content, 'utf-8');
  });

  // No dictionary anywhere in agent-runner: the empty {} makes extractIssue's
  // internal de-anonymization step a no-op, so ISSUE.md keeps whatever
  // placeholders the parcel already carries — decoding stays reports' job.
  const issueFile = extractIssue(worktreeDir, manifest, {}, candidate.file.id, assets);

  let title = issueFile.title;
  let description = issueFile.description;
  let model: string | undefined;

  if (review) {
    const result = await reviewIssueBeforeDispatch({ title, description, imagePaths: issueFile.imagePaths });

    if (!result.proceed) {
      log.info(`Skipping ${key}: declined at review — parcel left unclaimed for the next run.`);
      removeTaskWorktree(project.path, worktreeDir);
      rmSync(worktreeDir, { recursive: true, force: true });
      return;
    }

    title = result.title;
    description = result.description;
    model = result.model;

    if (title !== issueFile.title || description !== issueFile.description) {
      updateIssueFile(issueFile.path, manifest, title, description, issueFile.imagePaths, candidate.file.id);
    }
  }

  // The edited (or untouched) title/description is what actually becomes
  // part of the repo's history — committed here, not applied silently after
  // the fact — so "before" always matches what was really dispatched.
  commitAll(worktreeDir, `Task #${manifest.issueIid}: before (parcel ${candidate.file.id})`);
  pushBranch(worktreeDir, branch);
  log.info(`Pushed "before" commit to origin/${branch}.`);

  // The parcel was only peeked at so far; it is consumed once its content is
  // safely on the branch, so any earlier failure leaves it on bridge.
  await client.delete(candidate.file.id);

  const prompt = buildIssuePrompt(title, description);
  const { exitCode } = await runClaude(worktreeDir, prompt, model);

  if (!(await resultIsFreeOfOwnCredentials(worktreeDir, project, loadCredentialsOrEmpty(), key))) {
    return;
  }

  commitAll(
    worktreeDir,
    exitCode === 0
      ? `Task #${manifest.issueIid}: after (agent result)`
      : `Task #${manifest.issueIid}: after (agent run failed, exit ${exitCode})`,
  );
  pushBranch(worktreeDir, branch);
  log.info(`Pushed "after" commit to origin/${branch}.`);

  if (exitCode !== 0) {
    log.error(`Claude exited with code ${exitCode} for ${key} — not pushing a result parcel back to bridge.`);
    removeTaskWorktree(project.path, worktreeDir);
    return;
  }

  const relPaths = await walkProjectFiles(worktreeDir, projectInclude(project), projectExclude(project));
  const resultFiles = readAndTransform(worktreeDir, relPaths, (text) => text);
  const resultHash = contentHash(resultFiles);

  const resultArchive = buildIssueArchive(resultFiles, {
    issueId: manifest.issueId,
    issueIid: manifest.issueIid,
    issueTitle: manifest.issueTitle,
    issueDescription: manifest.issueDescription,
    projectId: manifest.projectId,
    branch,
    createdAt: new Date().toISOString(),
  });

  const shouldEncrypt = Boolean(project.publicKeyPath);
  const resultBuffer = shouldEncrypt
    ? encryptBuffer(resultArchive, readFileSync(resolveFromRoot(project.publicKeyPath!), 'utf-8'))
    : resultArchive;

  const filename = issueParcelName(candidate.projectId, candidate.iid, shouldEncrypt);
  const stored = await client.upload(filename, resultBuffer, {
    channel: 'issue',
    taskKey: key,
    direction: 'result',
  });

  recordOwnOutput(key, resultHash);
  log.info(`Pushed result parcel "${filename}" back to bridge (storage id ${stored.id}) for ${key}.`);
  removeTaskWorktree(project.path, worktreeDir);
}

export async function runAgentOnce(name: string, review = false): Promise<void> {
  const config = loadConfig();
  const project = findProject(config, name);
  const client = new BridgeClient(config.bridge.apiUrl);

  const files = await client.listFiles();
  const candidates = findCandidates(files, project.gitlabProjectId);

  if (candidates.length === 0) {
    log.info(`No pending parcels for "${name}".`);
    return;
  }

  for (const candidate of candidates) {
    const key = issueKey(candidate.projectId, candidate.iid);
    try {
      await processCandidate(candidate, project, client, review);
    } catch (error) {
      const worktreeDir = path.join(AGENT_WORK_DIR, `${candidate.projectId}-${candidate.iid}`);
      log.error(
        `Error processing ${key}: ${(error as Error).message}\n` +
          `The worktree was left in place for inspection: ${worktreeDir}\n` +
          `(the "before" commit may already be pushed to origin — check "git log" there before retrying).`,
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function agentRunnerCommand(name: string, options: { watch?: string; review?: boolean }): Promise<void> {
  if (options.watch && options.review) {
    throw new Error('--review needs a human at the keyboard for each parcel — it cannot be combined with --watch.');
  }

  if (!options.watch) {
    await runAgentOnce(name, options.review ?? false);
    return;
  }

  const intervalSec = Number(options.watch);
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
    throw new Error(`--watch expects a positive number of seconds, got "${options.watch}".`);
  }

  log.info(`Watching for parcels every ${intervalSec}s. Ctrl+C to stop.`);
  for (;;) {
    await runAgentOnce(name).catch((error: unknown) => {
      log.error(error instanceof Error ? error.message : error);
    });
    await sleep(intervalSec * 1000);
  }
}
