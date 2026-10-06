import { Column, Entity, PrimaryColumn } from 'typeorm';

// One row per (account, self-reported client name) — the closed-contour
// counterpart of WorkerHeartbeat. Where worker's liveness is a side effect of
// its claim poll, reports' is an explicit POST (reports talks to bridge only
// when it has something to do, so an idle contour would otherwise look dead).
@Entity({ name: 'client_heartbeats' })
export class ClientHeartbeat {
  @PrimaryColumn({ type: 'int', unsigned: true })
  userId: number;

  @PrimaryColumn({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  kind: string;

  @Column({ type: 'timestamp' })
  lastSeenAt: Date;

  // The state last announced to Telegram — lets the sweep (and the next
  // heartbeat) notify only on a transition, not on every tick.
  @Column({ type: 'boolean', default: true })
  isUp: boolean;
}
