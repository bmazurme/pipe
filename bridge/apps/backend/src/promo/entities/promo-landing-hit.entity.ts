import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { HitDevice, HitKind } from '../landing-hits';

// One event on the landing page. Nothing here identifies a person: no IP, no user agent, no cookie id — `visitor` is a hash that
// changes every day, enough to count distinct visitors within a day and nothing more.
@Entity({ name: 'promo_landing_hits' })
export class PromoLandingHit {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'timestamptz', default: () => 'now()' })
  at: Date;

  @Column({ type: 'varchar', length: 8 })
  kind: HitKind;

  @Column({ type: 'varchar', length: 16 })
  visitor: string;

  @Column({ type: 'varchar', length: 8 })
  device: HitDevice;

  @Column({ type: 'varchar', length: 2, nullable: true })
  lang: string | null;

  // The host of the page the visitor came from (never the full address); null for a direct visit or a visit from the landing itself.
  @Column({ type: 'varchar', length: 80, nullable: true })
  referrer: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  utmSource: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  utmMedium: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  utmCampaign: string | null;

  // A click: the host of the link that was followed (t.me, youtube.com, ...).
  @Column({ type: 'varchar', length: 80, nullable: true })
  target: string | null;

  // A click: the id of the page section the link is in.
  @Column({ type: 'varchar', length: 40, nullable: true })
  section: string | null;
}
