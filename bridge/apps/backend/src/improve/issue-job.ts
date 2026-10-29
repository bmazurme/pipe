import { StoredFileDirection } from '../storage/entities/stored-file.entity';
import type { StorageService } from '../storage/storage.service';
import type { WorkerCapability } from '../worker/capabilities';
import type { JobModel } from '../worker/entities/job.entity';
import type { WorkerService } from '../worker/worker.service';
import { buildIssueParcel, type IssueRef, type SnapshotFile } from './parcel';

export type IssueParcelTask = IssueRef;

export type IssueJobInput = {
  userId: number;
  files: SnapshotFile[];
  task: IssueParcelTask;
  baseline: Record<string, string>;
  fileName: string;
  taskKey: string;
  model: JobModel;
  // A saved Context the job carries; omitted from the job input unless set.
  contextId?: number | null;
  requiredCapability?: WorkerCapability;
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
  const job = await deps.workers.create(userId, {
    sourceFileId: stored.id,
    model: input.model,
    ...(input.contextId ? { contextId: input.contextId } : {}),
    ...(input.requiredCapability
      ? { requiredCapability: input.requiredCapability }
      : {}),
  });

  return { job, storedFileId: stored.id };
}
