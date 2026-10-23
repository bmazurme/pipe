import { Injectable } from '@nestjs/common';

import { SharedAsyncCache } from '../common/shared-async-cache';
import { readZipball, type SnapshotFile } from '../common/zip';
import { GithubApiService } from '../loop/github-api.service';
import { StoredFileDirection } from '../storage/entities/stored-file.entity';
import { StorageService } from '../storage/storage.service';
import { JobModel } from '../worker/entities/job.entity';
import { WorkerService } from '../worker/worker.service';
import {
  buildIssueParcel,
  selectParcelFiles,
  snapshotBaseline,
} from './parcel';

const ZIP_CACHE_TTL_MS = 10 * 60 * 1000;

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

  constructor(
    private readonly github: GithubApiService,
    private readonly storage: StorageService,
    private readonly workers: WorkerService,
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
    const files = selectParcelFiles(
      await readZipball(await this.github.downloadZipball(sha)),
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
    const baseBranch = snapshot?.branch ?? this.github.baseBranch();
    const { baseSha, files, baseline } =
      prepared ??
      (snapshot
        ? {
            baseSha: snapshot.sha,
            ...(await this.headSnapshotAt(snapshot.sha)),
          }
        : await this.prepareSnapshot(baseBranch));
    const { buffer } = await buildIssueParcel(
      files,
      {
        number: task.number,
        title: task.title,
        body: task.body,
        repo: this.github.repoName() as string,
        baseBranch,
      },
      new Date(),
      baseline,
    );
    const stored = await this.storage.createFromBuffer(
      userId,
      buffer,
      fileName,
      {
        channel: 'issue',
        taskKey,
        direction: StoredFileDirection.Outbound,
      },
    );
    const job = await this.workers.create(userId, {
      sourceFileId: stored.id,
      model: model as JobModel,
      ...(contextId !== null ? { contextId } : {}),
    });

    return { job, baseSha, baseline, fileCount: files.length };
  }
}
