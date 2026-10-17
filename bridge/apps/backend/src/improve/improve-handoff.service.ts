import { Injectable } from '@nestjs/common';

import { GithubApiService } from '../loop/github-api.service';
import { StoredFileDirection } from '../storage/entities/stored-file.entity';
import { StorageService } from '../storage/storage.service';
import { JobModel } from '../worker/entities/job.entity';
import { WorkerService } from '../worker/worker.service';
import {
  buildIssueParcel,
  readZipball,
  selectParcelFiles,
  snapshotBaseline,
  SnapshotFile,
} from './parcel';

const ZIP_CACHE_TTL_MS = 10 * 60 * 1000;

export type PreparedSnapshot = {
  baseSha: string;
  files: SnapshotFile[];
  baseline: Record<string, string>;
};

// Turns "a task + a commit" into a Worker job: the repo snapshot at that commit (cached
// across consecutive launches) → parcel with the task as its manifest → Storage → job.
@Injectable()
export class ImproveHandoffService {
  // One repo snapshot, reused by consecutive launches on the same base SHA.
  // The baseline hashes are cached with it: hashing the whole repo is synchronous.
  private zipCache: {
    sha: string;
    files: SnapshotFile[];
    baseline: Record<string, string>;
    at: number;
  } | null = null;
  // The snapshot being built right now, so concurrent starts on one SHA share a single download.
  private zipPending: {
    sha: string;
    promise: Promise<{
      files: SnapshotFile[];
      baseline: Record<string, string>;
    }>;
  } | null = null;

  constructor(
    private readonly github: GithubApiService,
    private readonly storage: StorageService,
    private readonly workers: WorkerService,
  ) {}

  async snapshotAt(sha: string) {
    const cached = this.zipCache;
    if (
      cached &&
      cached.sha === sha &&
      Date.now() - cached.at < ZIP_CACHE_TTL_MS
    ) {
      return { files: cached.files, baseline: cached.baseline };
    }
    if (this.zipPending?.sha === sha) return this.zipPending.promise;

    const promise = (async () => {
      const files = selectParcelFiles(
        await readZipball(await this.github.downloadZipball(sha)),
      );
      const baseline = snapshotBaseline(files);
      this.zipCache = { sha, files, baseline, at: Date.now() };

      return { files, baseline };
    })();
    const pending = { sha, promise };
    this.zipPending = pending;

    try {
      return await promise;
    } finally {
      if (this.zipPending === pending) this.zipPending = null;
    }
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
            ...(await this.snapshotAt(snapshot.sha)),
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
