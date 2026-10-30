import { githubDispatcher } from '../common/github-dispatcher';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const API = 'https://api.github.com';
const TIMEOUT_MS = 20_000;
const MAX_FILE_PAGES = 10;
const ZIPBALL_TIMEOUT_MS = 90_000;

interface IssueRaw {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: Array<{ name: string } | string>;
  html_url: string;
  created_at: string;
  pull_request?: unknown;
}

function toIssueInfo(item: IssueRaw): IssueInfo {
  return {
    number: item.number,
    title: item.title,
    body: item.body ?? '',
    state: item.state,
    labels: item.labels.map((label) =>
      typeof label === 'string' ? label : label.name,
    ),
    htmlUrl: item.html_url,
    createdAt: item.created_at,
  };
}

export interface PullInfo {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  draft: boolean;
  // null while GitHub is still computing it.
  mergeable: boolean | null;
  baseRef: string;
  headSha: string;
  // The branch the PR is made from, and the repository it lives in (a fork's PR cannot be pushed to).
  headRef: string;
  headRepo: string | null;
  labels: string[];
  htmlUrl: string;
}

export interface IssueInfo {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  htmlUrl: string;
  createdAt: string;
}

export interface TreeEntry {
  path: string;
  mode: '100644';
  type: 'blob';
  // null deletes the path from the base tree.
  sha: string | null;
}

export type CiState = 'success' | 'pending' | 'failure' | 'none';

// One failed check run of a commit, with what GitHub shows for it: the run's own summary and
// its annotations (a lint or test failure becomes one annotation with file, line and message).
export interface FailedCheck {
  name: string;
  conclusion: string;
  summary: string;
  annotations: Array<{
    path: string;
    line: number | null;
    level: string;
    message: string;
  }>;
}

// refs/heads/<branch> with every segment encoded, "/" kept.
function refPath(branch: string): string {
  return `/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`;
}

// bridge's own GitHub access for the loop — separate from BRIDGE_GITHUB_TOKEN
// (which only has what the VPN page needs). Needs, on this repo only:
// Pull requests: read & write, Contents: write (merging), Checks: read.
@Injectable()
export class GithubApiService {
  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.repo() && this.token());
  }

  async getPull(number: number): Promise<PullInfo> {
    const pr = (await this.get(`/pulls/${number}`)) as {
      number: number;
      title: string;
      state: string;
      merged: boolean;
      draft: boolean;
      mergeable: boolean | null;
      base: { ref: string };
      head: { sha: string; ref: string; repo: { full_name: string } | null };
      labels: Array<{ name: string }>;
      html_url: string;
    };

    return {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      merged: pr.merged,
      draft: pr.draft,
      mergeable: pr.mergeable,
      baseRef: pr.base.ref,
      headSha: pr.head.sha,
      headRef: pr.head.ref,
      headRepo: pr.head.repo?.full_name ?? null,
      labels: pr.labels.map((label) => label.name),
      htmlUrl: pr.html_url,
    };
  }

  // Every changed file, paged. A PR bigger than the cap is refused rather
  // than half-checked — an unchecked tail could hide a protected path.
  async listPullFiles(number: number): Promise<string[]> {
    const files: string[] = [];

    for (let page = 1; page <= MAX_FILE_PAGES; page++) {
      const batch = (await this.get(
        `/pulls/${number}/files?per_page=100&page=${page}`,
      )) as Array<{ filename: string; previous_filename?: string }>;

      for (const file of batch) {
        files.push(file.filename);
        // A rename out of a protected path is still a change to it.
        if (file.previous_filename) files.push(file.previous_filename);
      }

      if (batch.length < 100) return files;
    }

    throw new Error('PR слишком большой, чтобы проверить список файлов');
  }

  async ciState(sha: string): Promise<CiState> {
    const data = (await this.get(
      `/commits/${sha}/check-runs?per_page=100`,
    )) as {
      check_runs: Array<{ status: string; conclusion: string | null }>;
    };
    const runs = data.check_runs;

    if (runs.length === 0) return 'none';

    if (
      runs.some((run) =>
        ['failure', 'timed_out', 'cancelled', 'action_required'].includes(
          run.conclusion ?? '',
        ),
      )
    ) {
      return 'failure';
    }

    if (runs.some((run) => run.status !== 'completed')) return 'pending';

    return 'success';
  }

  // ---- Improve module: read issues, snapshot the repo, commit a branch, open a PR.
  // Needs, on top of the loop's own permissions: Issues: read, Contents: write
  // (create a branch and commits) and Pull requests: write (open the PR).

  isReady(): boolean {
    return this.isConfigured();
  }

  repoName(): string | undefined {
    return this.repo();
  }

  baseBranch(): string {
    return this.configService.get<string>('GITHUB_BASE_BRANCH') || 'main';
  }

  // Open issues carrying the label (any open issue when the label is empty), oldest first. The issues endpoint also lists
  // pull requests (they are issues too) — those are filtered out.
  async listOpenIssues(label: string, limit = 50): Promise<IssueInfo[]> {
    const items = (await this.get(
      `/issues?state=open${label ? `&labels=${encodeURIComponent(label)}` : ''}&sort=created&direction=asc&per_page=${Math.min(limit, 100)}`,
    )) as Array<IssueRaw>;

    return items.filter((item) => !item.pull_request).map(toIssueInfo);
  }

  async getIssue(number: number): Promise<IssueInfo & { isPull: boolean }> {
    const item = (await this.get(`/issues/${number}`)) as IssueRaw;

    return { ...toIssueInfo(item), isPull: Boolean(item.pull_request) };
  }

  // Every issue title (open and closed, pull requests excluded), so an analysis is told
  // what was already proposed and a new proposal can be checked for a duplicate.
  async listIssueTitles(
    max = 300,
  ): Promise<Array<{ number: number; title: string }>> {
    const titles: Array<{ number: number; title: string }> = [];

    for (let page = 1; titles.length < max; page++) {
      const batch = (await this.get(
        `/issues?state=all&per_page=100&page=${page}`,
      )) as Array<IssueRaw>;

      titles.push(
        ...batch
          .filter((item) => !item.pull_request)
          .map((item) => ({ number: item.number, title: item.title })),
      );

      if (batch.length < 100) break;
    }

    return titles.slice(0, max);
  }

  async createIssue(input: {
    title: string;
    body: string;
    labels: string[];
  }): Promise<{ number: number; htmlUrl: string; missingLabels: string[] }> {
    const data = (await this.post('/issues', input)) as {
      number: number;
      html_url: string;
      labels?: Array<{ name: string } | string>;
    };
    const names = (labels: Array<{ name: string } | string> = []) =>
      labels.map((label) => (typeof label === 'string' ? label : label.name));
    const missing = (applied: string[]) =>
      input.labels.filter((label) => !applied.includes(label));
    let missingLabels = missing(names(data.labels));

    // GitHub drops the labels of a *new* issue without a word when the token is not
    // allowed to set them there, and the issue then never shows up in Improve (which
    // lists by the `loop` label). Setting them on the existing issue is a different
    // permission check, so try that, and report whatever still did not stick.
    if (missingLabels.length > 0) {
      try {
        const applied = (await this.post(`/issues/${data.number}/labels`, {
          labels: missingLabels,
        })) as Array<{ name: string } | string>;

        missingLabels = missing(names(applied));
      } catch {
        // Reported through missingLabels below.
      }
    }

    return { number: data.number, htmlUrl: data.html_url, missingLabels };
  }

  async getBranchSha(branch: string): Promise<string> {
    const data = (await this.get(
      `/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`,
    )) as { object: { sha: string } };

    return data.object.sha;
  }

  async getCommitTreeSha(commitSha: string): Promise<string> {
    const data = (await this.get(`/git/commits/${commitSha}`)) as {
      tree: { sha: string };
    };

    return data.tree.sha;
  }

  // The repository at one commit, as a zip. GitHub answers with a redirect to its
  // download host; fetch follows it (dropping the token for the other origin).
  async downloadZipball(sha: string): Promise<Uint8Array> {
    const response = await this.request(
      `/zipball/${sha}`,
      {},
      ZIPBALL_TIMEOUT_MS,
    );

    return new Uint8Array(await response.arrayBuffer());
  }

  async createBlob(bytes: Uint8Array): Promise<string> {
    const data = (await this.post('/git/blobs', {
      content: Buffer.from(bytes).toString('base64'),
      encoding: 'base64',
    })) as { sha: string };

    return data.sha;
  }

  async createTree(baseTreeSha: string, tree: TreeEntry[]): Promise<string> {
    const data = (await this.post('/git/trees', {
      base_tree: baseTreeSha,
      tree,
    })) as { sha: string };

    return data.sha;
  }

  async createCommit(
    message: string,
    treeSha: string,
    parentSha: string,
  ): Promise<string> {
    const data = (await this.post('/git/commits', {
      message,
      tree: treeSha,
      parents: [parentSha],
    })) as { sha: string };

    return data.sha;
  }

  async createBranch(branch: string, sha: string): Promise<void> {
    await this.post('/git/refs', { ref: `refs/heads/${branch}`, sha });
  }

  async createPull(input: {
    title: string;
    head: string;
    base: string;
    body: string;
  }): Promise<{ number: number; htmlUrl: string }> {
    const data = (await this.post('/pulls', input)) as {
      number: number;
      html_url: string;
    };

    return { number: data.number, htmlUrl: data.html_url };
  }

  async addLabels(number: number, labels: string[]): Promise<void> {
    await this.post(`/issues/${number}/labels`, { labels });
  }

  // Squash, pinned to the exact head sha that was checked: if anything was
  // pushed after the check, GitHub refuses (409) instead of merging it.
  async merge(number: number, sha: string): Promise<void> {
    await this.request(`/pulls/${number}/merge`, {
      method: 'PUT',
      body: JSON.stringify({ merge_method: 'squash', sha }),
    });
  }

  private async get(path: string): Promise<unknown> {
    return (await this.request(path)).json();
  }

  // ---- Improve: repairing a red pull request, and not leaving a branch behind when no PR comes of it.
  // Needs Contents: write (the branch) and Checks: read (what failed).

  async deleteBranch(branch: string): Promise<void> {
    await this.request(refPath(branch), { method: 'DELETE' });
  }

  // Fast-forwards the branch to a commit made on top of its current head (never forced: a branch somebody pushed to meanwhile is refused).
  async updateBranch(branch: string, sha: string): Promise<void> {
    await this.request(refPath(branch), {
      method: 'PATCH',
      body: JSON.stringify({ sha, force: false }),
    });
  }

  // How many commits of `base` the head is missing. GitHub only says "behind" when the branch-protection rule "require branches to be up
  // to date" is on, which this repository (free plan) does not have, so ask the comparison itself.
  async behindBy(base: string, headSha: string): Promise<number> {
    const data = (await this.get(`/compare/${base}...${headSha}`)) as {
      behind_by?: number;
    };

    return data.behind_by ?? 0;
  }

  // "Update branch": merges the base into the PR's branch as a commit on top (never a force push; refused with 409 when the head moved
  // since `expectedHeadSha`, and with 422 when the merge has conflicts). The new commit is pushed by the token's owner, so CI runs on it.
  async updatePullBranch(
    number: number,
    expectedHeadSha: string,
  ): Promise<void> {
    await this.request(`/pulls/${number}/update-branch`, {
      method: 'PUT',
      body: JSON.stringify({ expected_head_sha: expectedHeadSha }),
    });
  }

  // Re-runs the failed jobs of the workflow runs that ended in failure on this commit (GitHub's "Re-run failed jobs"): a flaky test passes
  // the second time, and nothing needed a worker. Returns how many workflow runs were asked to re-run. Needs Actions: write.
  async rerunFailedRuns(sha: string): Promise<number> {
    const data = (await this.get(
      `/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=20`,
    )) as { workflow_runs: Array<{ id: number; conclusion: string | null }> };
    const failed = data.workflow_runs.filter((run) =>
      ['failure', 'timed_out'].includes(run.conclusion ?? ''),
    );

    for (const run of failed) {
      await this.request(`/actions/runs/${run.id}/rerun-failed-jobs`, {
        method: 'POST',
      });
    }

    return failed.length;
  }

  // Closes a pull request with a comment saying why (the comment first, so the reason is there when someone opens the closed PR).
  async closePull(number: number, comment: string): Promise<void> {
    await this.post(`/issues/${number}/comments`, { body: comment });
    await this.request(`/pulls/${number}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed' }),
    });
  }

  // The check runs of a commit that failed or timed out (a cancelled run is not a failure to repair), each with its annotations.
  async failedChecks(sha: string): Promise<FailedCheck[]> {
    const data = (await this.get(
      `/commits/${sha}/check-runs?per_page=100`,
    )) as {
      check_runs: Array<{
        id: number;
        name: string;
        conclusion: string | null;
        output?: { title?: string | null; summary?: string | null };
      }>;
    };
    const failed = data.check_runs.filter((run) =>
      ['failure', 'timed_out'].includes(run.conclusion ?? ''),
    );

    return Promise.all(
      failed.map(async (run) => {
        const annotations = (await this.get(
          `/check-runs/${run.id}/annotations?per_page=50`,
        ).catch(() => [])) as Array<{
          path: string;
          start_line: number | null;
          annotation_level: string;
          message: string;
        }>;

        return {
          name: run.name,
          conclusion: run.conclusion as string,
          summary: [run.output?.title, run.output?.summary]
            .filter(Boolean)
            .join(' — '),
          annotations: annotations.map((annotation) => ({
            path: annotation.path,
            line: annotation.start_line,
            level: annotation.annotation_level,
            message: annotation.message,
          })),
        };
      }),
    );
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    return (
      await this.request(path, { method: 'POST', body: JSON.stringify(body) })
    ).json();
  }

  private async request(
    path: string,
    init: RequestInit = {},
    timeoutMs = TIMEOUT_MS,
  ): Promise<Response> {
    const response = await fetch(`${API}/repos/${this.repo()}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token()}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
      dispatcher: githubDispatcher(),
    } as RequestInit);

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;

      throw new Error(
        `GitHub ${response.status}${body?.message ? `: ${body.message}` : ''}`,
      );
    }

    return response;
  }

  private repo(): string | undefined {
    return this.configService.get<string>('GITHUB_REPO') || undefined;
  }

  private token(): string | undefined {
    return this.configService.get<string>('LOOP_GITHUB_TOKEN') || undefined;
  }
}
