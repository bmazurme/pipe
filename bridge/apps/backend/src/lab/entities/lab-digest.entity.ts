import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import type { DigestItem } from '../lab-digest';

export enum LabDigestStatus {
  // The worker job exists (or is about to) and has not finished.
  Generating = 'generating',
  // The note is written and waits for the owner: nothing has left bridge.
  Draft = 'draft',
  // The owner says they carried it to notes.ntlstl.dev.
  Exported = 'exported',
  Failed = 'failed',
}

// A weekly digest: the finished worker work of one week (Lab, Improve, parcels) and the note a worker wrote about it. Draft only —
// publishing to notes.ntlstl.dev is a separate step the owner does.
@Entity({ name: 'lab_digests' })
@Index('IDX_lab_digests_userId_weekStart', ['userId', 'weekStart'], {
  unique: true,
})
@Index('IDX_lab_digests_status', ['status'])
export class LabDigest extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  // 'YYYY-MM-DD' of the Monday (Moscow time).
  @Column({ type: 'varchar', length: 10 })
  weekStart: string;

  @Column({ type: 'varchar', length: 16, default: LabDigestStatus.Generating })
  status: LabDigestStatus;

  // Whether work in private (or unknown) repositories and parcels was allowed in. Off unless the owner turned it on.
  @Column({ type: 'boolean', default: false })
  includePrivate: boolean;

  @Column({ type: 'varchar', length: 32 })
  model: string;

  @Column({ type: 'int', unsigned: true, nullable: true })
  jobId: number | null;

  // What the digest is about, as it was when it was started.
  @Column({ type: 'jsonb', default: () => `'[]'` })
  items: DigestItem[];

  // How many finished works were left out because their repository is not public.
  @Column({ type: 'int', unsigned: true, default: 0 })
  excludedPrivate: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  title: string | null;

  @Column({ type: 'text', nullable: true })
  preview: string | null;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  tags: string[];

  // The type on notes.ntlstl.dev.
  @Column({ type: 'varchar', length: 100, default: 'Dev Work Diary' })
  noteType: string;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'timestamp', nullable: true })
  exportedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;
}
