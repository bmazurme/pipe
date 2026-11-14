import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../base.entity';

// One uploaded version of the landing page: a zip in the FileStore (the source of truth) unpacked into
// <LANDING_DIR>/releases/<dirName>. The live site is the one `current` points at; activatedAt says which release was switched on
// last, so a board with an empty volume (after a failover) knows which one to unpack again.
@Entity({ name: 'promo_landing_releases' })
export class PromoLandingRelease extends BaseEntity {
  @Column({ type: 'varchar', length: 120 })
  label: string;

  @Column({ type: 'varchar', length: 255 })
  storedName: string;

  @Column({ type: 'varchar', length: 64 })
  dirName: string;

  @Column({ type: 'int' })
  fileCount: number;

  @Column({ type: 'int' })
  sizeBytes: number;

  @Column({ type: 'timestamp', nullable: true })
  activatedAt: Date | null;
}
