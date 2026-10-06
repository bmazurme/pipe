import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveTrackedProject } from './config-handler';

const original = globalThis.fetch;

beforeEach(() => {
  process.env.GITHUB_TOKEN = 'ghp_test';
});

afterEach(() => {
  globalThis.fetch = original;
  delete process.env.GITHUB_TOKEN;
});

describe('resolveTrackedProject', () => {
  it('passes a plain GitLab project through untouched', async () => {
    const project = { gitlabProjectId: '173', path: '/x' };

    await expect(resolveTrackedProject(project)).resolves.toBe(project);
  });

  it('resolves a GitHub repo to its numeric id and canonical name', async () => {
    globalThis.fetch = (async () => Response.json({ id: 555, full_name: 'Owner/Repo' })) as typeof fetch;

    await expect(resolveTrackedProject({ gitlabProjectId: '', githubRepo: 'owner/repo', path: '/x' })).resolves.toMatchObject({
      provider: 'github',
      githubRepo: 'Owner/Repo',
      gitlabProjectId: '555',
    });
  });

  it("rejects a repo that is not in 'owner/name' form", async () => {
    await expect(resolveTrackedProject({ gitlabProjectId: '', provider: 'github', githubRepo: 'nope', path: '/x' })).rejects.toThrow(/owner\/name/);
  });
});
