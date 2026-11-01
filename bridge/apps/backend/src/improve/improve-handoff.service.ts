import { Injectable, Logger } from '@nestjs/common';

import { SharedAsyncCache } from '../common/shared-async-cache';
import { readZipball, type SnapshotFile } from '../common/zip';
import { GithubApiService } from '../loop/github-api.service';
import { RouterService } from '../router/router.service';
import { StorageService } from '../storage/storage.service';
import { WorkerService } from '../worker/worker.service';
import { withoutDefinitionOfDone } from './definition-of-done';
import { message, withTransientRetry } from './improve-shared';
import { launchIssueJob } from './issue-job';
import {
  isExcludedPath,
  MAX_FILE_BYTES,
  selectParcelFiles,
  snapshotBaseline,
} from './parcel';

const ZIP_CACHE_TTL_MS = 10 * 60 * 1000;
const SNAPSHOT_RETRY_DELAY_MS = 2000;

type CachedSnapshot = {
  files: SnapshotFile[];
  baseline: Record<string, string>;
};

export type PreparedSnapshot = {
  baseSha: string;
  files: SnapshotFile[];
  baseline: Record<string, string>;
};

// Turns "a task + a commit" into a Worker job: the repo snapshot at that commit (cached
// across consecutive launches) → parcel with the task as its manifest → Storage → job.
@Injectable()
export class ImproveHandoffService {
  // Repo snapshots, reused by consecutive launches on the same SHA and shared by concurrent
  // ones. The baseline hashes are cached with them: hashing the whole repo is synchronous.
  // The base branch (issue runs, analyses) and PR heads (CI repairs, chat PR fixes) have a
  // cache each, so a repair does not evict the base branch: at most two snapshots in memory.
  private readonly baseSnapshots = new SharedAsyncCache<CachedSnapshot>({
    ttlMs: ZIP_CACHE_TTL_MS,
    maxEntries: 1,
  });
  private readonly headSnapshots = new SharedAsyncCache<CachedSnapshot>({
    ttlMs: ZIP_CACHE_TTL_MS,
    maxEntries: 1,
  });

  private readonly logger = new Logger(ImproveHandoffService.name);
  protected retryDelayMs = SNAPSHOT_RETRY_DELAY_MS;

  constructor(
    private readonly github: GithubApiService,
    private readonly storage: StorageService,
    private readonly workers: WorkerService,
    private readonly router: RouterService,
  ) {}

  // Snapshot of a base-branch commit.
  snapshotAt(sha: string) {
    return this.baseSnapshots.get(sha, () => this.loadSnapshot(sha));
  }

  // Snapshot of a PR head, kept apart from the base branch's.
  private headSnapshotAt(sha: string) {
    return this.headSnapshots.get(sha, () => this.loadSnapshot(sha));
  }

  private async loadSnapshot(sha: string): Promise<CachedSnapshot> {
    // Excluded and oversize entries are never inflated (and no worker threads are used).
    const files = selectParcelFiles(
      await readZipball(
        await withTransientRetry(() => this.github.downloadZipball(sha), {
          delayMs: this.retryDelayMs,
          onRetry: (error) =>
            this.logger.warn(
              `improve.snapshot_retry: ${sha}: ${message(error)}`,
            ),
        }),
        (path, size) =>
          !isExcludedPath(path) && size > 0 && size <= MAX_FILE_BYTES,
      ),
    );

    return { files, baseline: snapshotBaseline(files) };
  }

  // Base-branch SHA + parcel files; independent of the task, so it can start early.
  async prepareSnapshot(branch?: string): Promise<PreparedSnapshot> {
    const baseSha = await this.github.getBranchSha(
      branch ?? this.github.baseBranch(),
    );
    const { files, baseline } = await this.snapshotAt(baseSha);

    return { baseSha, files, baseline };
  }

  // Snapshot of the base branch → parcel with this task as its manifest → Storage →
  // Worker job. Shared by issue runs and analysis runs (an analysis is a task whose
  // description is the prompt).
  async handToWorker(
    userId: number,
    model: string,
    task: { number: number | string; title: string; body: string },
    taskKey: string,
    fileName: string,
    // A CI repair works on the PR's branch as it is now, not on the base branch.
    snapshot?: { sha: string; branch: string },
    prepared?: PreparedSnapshot,
    // A saved Context (Context page) the run's worker job carries as background text; the job keeps its own snapshot.
    contextId: number | null = null,
  ) {
    // 'auto': the model router picks (a few seconds of Haiku, or none when a rule of the owner's decides by words); a model the owner
    // named passes through, and so does every run that is not an issue run (analysis, repair, chat fix), which always has one.
    const { model: chosen, routing } = await this.router.resolve({
      userId,
      model,
      title: task.title,
      // the task as it was written, not the build-and-test instructions every task carries
      task: withoutDefinitionOfDone(task.body),
      executor: 'any',
    });
    const baseBranch = snapshot?.branch ?? this.github.baseBranch();
    const { baseSha, files, baseline } =
      prepared ??
      (snapshot
        ? {
            baseSha: snapshot.sha,
            ...(await this.headSnapshotAt(snapshot.sha)),
          }
        : await this.prepareSnapshot(baseBranch));
    const { job } = await launchIssueJob(
      { storage: this.storage, workers: this.workers },
      {
        userId,
        files,
        task: {
          number: task.number,
          title: task.title,
          body: task.body,
          repo: this.github.repoName() as string,
          baseBranch,
        },
        baseline,
        fileName,
        taskKey,
        model: chosen,
        contextId,
      },
    );

    return {
      job,
      baseSha,
      baseline,
      fileCount: files.length,
      // the model the job really got, and why when the router chose it
      model: chosen,
      routing,
    };
  }
}
