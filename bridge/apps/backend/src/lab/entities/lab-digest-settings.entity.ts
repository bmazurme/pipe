import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

// How the owner's weekly digests are made. One row per account, created on the first save; no row = the defaults below.
@Entity({ name: 'lab_digest_settings' })
@Index('IDX_lab_digest_settings_userId', ['userId'], { unique: true })
export class LabDigestSettings extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  // Make the digest of the week that ended by itself, from Monday 06:00 Moscow time. Costs one worker run.
  @Column({ type: 'boolean', default: false })
  autoWeekly: boolean;

  // Allow private repositories and parcels (GitLab) in. Off: only work in public GitHub repositories is used.
  @Column({ type: 'boolean', default: false })
  includePrivate: boolean;

  // A model, or 'custom:<key id>' — never 'auto': there is no task text for the router to size.
  @Column({ type: 'varchar', length: 32, default: 'haiku' })
  model: string;
}
