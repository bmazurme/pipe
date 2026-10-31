import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import type { RouterRule, Tier } from '../router-policy';

// One row per owner: which model each size tier of a task goes to, and the rules that send a task by its words to a fixed model.
// No row = the defaults (router-policy.ts).
@Entity({ name: 'router_settings' })
export class RouterSettingsRow extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @Column({ type: 'jsonb' })
  tierModels: Record<Tier, string>;

  @Column({ type: 'jsonb' })
  rules: RouterRule[];
}
