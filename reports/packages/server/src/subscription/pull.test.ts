import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { SettingsType, SubscriptionConfigType } from '@reports/shared';

// Same mocking depth as handler.test.ts: settings/state/config are in-memory
// fakes, git runs for real against a throwaway repo, only bridge is mocked
// through global fetch.
const getSettingsMock = vi.fn<() => SettingsType>();
vi.mock('../settings/props', () => ({ getSettings: () => getSettingsMock() }));

const stores = vi.hoisted(() => ({
  state: {} as Record<string, { step: string; [key: string]: unknown }>,
  config: null as unknown,
}));

vi.mock('./state-props', () => ({
  issueKey: (projectId: string | number, iid: string | number) => `${projectId}:${iid}`,
  getIssueState: (projectId: string | number, iid: string | number) => stores.state[`${projectId}:${iid}`],
  setIssueState: (projectId: string | number, iid: string | number, patch: Record<string, unknown>) => {
    const key = `${projectId}:${iid}`;
    stores.state[key] = { ...stores.state[key], ...patch, step: (patch.step as string | undefined) ?? 'init' };
    return stores.state[key];
  },
}));

vi.mock('./config-props', () => ({
  getSubscriptionConfig: () => stores.config,
  findTrackedProject: (gitlabProjectId: string | number) =>
    (stores.config as SubscriptionConfigType).trackedProjects.find((p) => p.gitlabProjectId === String(gitlabProjectId)),
  findMigration: () => undefined,
}));

const { pullSubscriptionIssue } = await import('./pull');
const { buildArchive } = await import('./pack');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

const originalFetch = globalThis.fetch;

// A repo whose task branch has `vendor -> outside` committed, plus the outside directory.
function setup(): { outside: string } {
  const remote = mkdtempSync(path.join(tmpdir(), 'reports-pull-test-remote-'));
  git(remote, ['init', '--quiet', '--bare']);
  const outside = mkdtempSync(path.join(tmpdir(), 'reports-pull-test-outside-'));
  const dir = mkdtempSync(path.join(tmpdir(), 'reports-pull-test-repo-'));
  git(dir, ['init', '--quiet', '-b', 'master']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'initial', '--quiet']);
  git(dir, ['remote', 'add', 'origin', remote]);
  git(dir, ['push', '-u', 'origin', 'master']);
  git(dir, ['checkout', '-b', 'task/173-6']);
  symlinkSync(outside, path.join(dir, 'vendor'));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'link', '--quiet']);
  git(dir, ['push', '-u', 'origin', 'task/173-6']);
  git(dir, ['checkout', 'master']);

  stores.config = {
    trackedProjects: [{ gitlabProjectId: '173', path: dir, baseBranch: 'master', include: ['**/*.ts'] }],
    dictionary: [],
    commentTemplates: [],
    encryption: { enabled: false, publicKey: '', privateKey: '' },
  } satisfies SubscriptionConfigType;
  stores.state['173:6'] = { step: 'pushed', branch: 'task/173-6' };

  return { outside };
}

function mockBridge(parcel: Buffer, onDelete: () => void): void {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.includes('/api/v1/storage?')) {
      return Response.json([{ id: 99, originalName: '173-6.subscription.zip', mimeType: 'application/zip', size: parcel.length, createdAt: new Date().toISOString(), channel: 'issue', taskKey: '173:6', direction: 'result' }]);
    }
    if (url.includes('/api/v1/storage/99/peek')) return new Response(parcel, { status: 200 });
    if (url.endsWith('/api/v1/storage/99') && init?.method === 'DELETE') {
      onDelete();
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected URL: ${url}`);
  }) as typeof fetch;
}

const manifest = { issueId: '1', issueIid: '6', issueTitle: 'Fix it', issueDescription: 'desc', projectId: 173, branch: 'task/173-6', createdAt: new Date().toISOString() };

beforeEach(() => {
  for (const key of Object.keys(stores.state)) delete stores.state[key];
  getSettingsMock.mockReturnValue({
    gitlabUrl: 'https://gitlab.example.com/api/v4',
    privateToken: 'token-123',
    userId: '7',
    employee: '',
    company: '',
    bridgeApiUrl: 'https://bridge.example.com',
    bridgeApiKey: '',
    bridgeStorageApiKey: 'brk_test',
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('pullSubscriptionIssue through a symlink in the task branch', () => {
  it('refuses a file entry under a symlinked directory', async () => {
    const { outside } = setup();
    let deleted = false;
    mockBridge(buildArchive([{ relPath: 'vendor/.ssh/authorized_keys', content: 'ssh-rsa evil' }], manifest), () => { deleted = true; });

    await expect(pullSubscriptionIssue('173', '6', { publish: true })).rejects.toThrow('недопустимый путь');

    expect(readdirSync(outside)).toEqual([]);
    expect(deleted).toBe(false);
    expect(stores.state['173:6'].step).toBe('pushed');
  });

  it('refuses an asset under a symlinked directory', async () => {
    const { outside } = setup();
    mkdirSync(path.join(outside, 'keep'));
    let deleted = false;
    const asset = { relPath: 'vendor/keep/image.png', base64: Buffer.from('png').toString('base64') };
    mockBridge(buildArchive([{ relPath: 'ok.txt', content: 'fine' }], manifest, [asset]), () => { deleted = true; });

    await expect(pullSubscriptionIssue('173', '6')).rejects.toThrow('недопустимый путь');

    expect(existsSync(path.join(outside, 'keep', 'image.png'))).toBe(false);
    expect(deleted).toBe(false);
  });
});
