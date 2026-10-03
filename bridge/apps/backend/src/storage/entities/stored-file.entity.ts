import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

export enum StoredFileDirection {
  Outbound = 'outbound',
  Result = 'result',
}

@Entity({ name: 'stored_files' })
@Index(['userId', 'taskKey'])
export class StoredFile extends BaseEntity {
  @Column({ type: 'int', unsigned: true, nullable: false })
  userId: number;

  @Column({ type: 'varchar', length: 255, nullable: false })
  originalName: string;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: false })
  storedName: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  mimeType: string;

  @Column({ type: 'int', unsigned: true, nullable: false })
  size: number;

  // All three optional and client-populated — bridge has no way to derive
  // them itself (GitLab project/issue numbers are entirely a client-side
  // concept, see the parcel manifest). A row with none of these set behaves
  // exactly as before (clients matching by filename pattern still works —
  // this is additive, not a replacement). See IMPROVEMENTS_TECH.md 2.3.
  @Column({ type: 'varchar', length: 64, nullable: true })
  channel: string | null;

  // "${projectId}:${iid}" — matches the same key shape sync's/reports'
  // local state files and harness already use (issueKey()).
  @Column({ type: 'varchar', length: 64, nullable: true })
  taskKey: string | null;

  @Column({ type: 'enum', enum: StoredFileDirection, nullable: true })
  direction: StoredFileDirection | null;
}
