import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const API = 'https://api.github.com';
const TIMEOUT_MS = 20_000;
const MAX_FILE_PAGES = 10;

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
  labels: string[];
  htmlUrl: string;
}

export type CiState = 'success' | 'pending' | 'failure' | 'none';

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
      head: { sha: string };
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

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const response = await fetch(`${API}/repos/${this.repo()}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token()}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

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
