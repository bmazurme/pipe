import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

// What limit alerts were already sent, per owner of the limit (a Claude token, or a worker with no known token) and
// plan window — so a restart or a busy hour does not repeat an announcement (see limit-alerts.ts).
@Entity({ name: 'limit_alert_states' })
export class LimitAlertState extends BaseEntity {
  // "<userId>:c<credentialId>" or "<userId>:w<workerId>"
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  ownerKey: string;

  // window name → { level, resetsAt }
  @Column({ type: 'jsonb' })
  windows: Record<string, { level: number; resetsAt: number | null }>;
}
