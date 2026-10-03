import { Column, Entity, PrimaryColumn } from 'typeorm';

// One row per (account, self-reported worker name), upserted on every single
// claim attempt (see WorkerService.claim) — whether or not a job was found.
// That's what makes this a genuine liveness signal distinct from Job's own
// claimedAt: a worker polling an empty queue updates nothing on Job, but
// still proves it's alive here.
@Entity({ name: 'worker_heartbeats' })
export class WorkerHeartbeat {
  @PrimaryColumn({ type: 'int', unsigned: true })
  userId: number;

  @PrimaryColumn({ type: 'varchar', length: 255 })
  workerName: string;

  @Column({ type: 'timestamp' })
  lastSeenAt: Date;
}
