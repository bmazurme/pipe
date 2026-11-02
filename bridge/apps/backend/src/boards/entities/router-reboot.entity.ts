import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

// pending: asked, nobody took it yet · taken: the agent has it and is rebooting · done / failed: the agent's verdict · expired: nobody took it in time
export type RouterRebootStatus =
  'pending' | 'taken' | 'done' | 'failed' | 'expired';

// The owner's wish to reboot the router (the button in Telegram). The agent on the board picks it up with its next report, reboots the router
// over SSH, waits for it to come back and says how it went. bridge never connects to the router, nor to the board.
@Entity({ name: 'router_reboots' })
@Index(['userId', 'host', 'status'])
export class RouterReboot extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @Column({ type: 'varchar', length: 100 })
  host: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: RouterRebootStatus;

  @Column({ type: 'timestamp', nullable: true })
  takenAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;

  // What the agent said when it was done.
  @Column({ type: 'text', nullable: true })
  result: string | null;
}
