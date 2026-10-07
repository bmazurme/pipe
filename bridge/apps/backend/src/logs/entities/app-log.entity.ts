import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

export type AppLogLevel = 'info' | 'warn' | 'error';
export type AppLogSource = 'http' | 'job' | 'loop' | 'integration' | 'system';

// Operational events kept so the system can be tuned later: what failed, how
// long jobs took, which integrations misbehaved. Deliberately NOT a request log —
// no bodies, no query strings, no headers; see AppLogService for the redaction.
@Entity({ name: 'app_logs' })
@Index(['source', 'level'])
export class AppLog extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 8 })
  level: AppLogLevel;

  @Column({ type: 'varchar', length: 16 })
  source: AppLogSource;

  // Machine-readable name, e.g. "job.failed", "http.slow", "telegram.api_failed".
  @Column({ type: 'varchar', length: 64 })
  event: string;

  @Column({ type: 'varchar', length: 500 })
  message: string;

  // Small JSON object (numbers/strings), serialized — never raw payloads.
  @Column({ type: 'text', nullable: true })
  meta: string | null;
}
