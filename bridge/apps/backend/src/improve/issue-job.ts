import { StoredFileDirection } from '../storage/entities/stored-file.entity';
import type { StorageService } from '../storage/storage.service';
import type { WorkerCapability } from '../worker/capabilities';
import type { Urgency } from '../worker/limit-planner';
import type { WorkerService } from '../worker/worker.service';
import { jobModelOf } from './improve-shared';
import { buildIssueParcel, type IssueRef, type SnapshotFile } from './parcel';

export type IssueParcelTask = IssueRef;

export type IssueJobInput = {
  userId: number;
  files: SnapshotFile[];
  task: IssueParcelTask;
  baseline: Record<string, string>;
  fileName: string;
  taskKey: string;
  // 'sonnet' … 'qwen', or 'custom:<key id>' for a stored custom model (improve-shared.ts).
  model: string;
  // A saved Context the job carries; omitted from the job input unless set.
  contextId?: number | null;
  // Put the baseline (path → sha256) in the parcel so the worker can run scripts/verify-changed.mjs; only the repository's own runs (Improve) have it.
  withBaseline?: boolean;
  requiredCapability?: WorkerCapability;
  // R10: who asked — the Claude-limit planner holds back a 'deferrable' job when the plan's window is nearly used up.
  urgency?: Urgency;
};

// Issue parcel → outbound `issue` file in Storage → Worker job pointing at it. The one
// place that knows what an issue job looks like on the wire; Improve and Lab both use it.
export async function launchIssueJob(
  deps: { storage: StorageService; workers: WorkerService },
  input: IssueJobInput,
) {
  const { userId } = input;
  const { buffer } = await buildIssueParcel(
    input.files,
    input.task,
    new Date(),
    input.baseline,
    { includeBaseline: input.withBaseline },
  );
  const stored = await deps.storage.createFromBuffer(
    userId,
    buffer,
    input.fileName,
    {
      channel: 'issue',
      taskKey: input.taskKey,
      direction: StoredFileDirection.Outbound,
    },
  );
  const job = await deps.workers.create(
    userId,
    {
      sourceFileId: stored.id,
      ...jobModelOf(input.model),
      ...(input.contextId ? { contextId: input.contextId } : {}),
      ...(input.requiredCapability
        ? { requiredCapability: input.requiredCapability }
        : {}),
    },
    undefined,
    input.urgency,
  );

  return { job, storedFileId: stored.id };
}
