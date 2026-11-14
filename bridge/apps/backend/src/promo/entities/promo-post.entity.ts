import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import type { PromoChannel, PromoMode, PromoPostStatus } from '../promo-limits';

// One post for one channel. There is no owner column on purpose: promo belongs to the single deployment owner (the controller is
// behind OwnerGuard), the way the Dashboard's tiles do.
@Entity({ name: 'promo_posts' })
export class PromoPost extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 16 })
  channel: PromoChannel;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  // The channel is bilingual: Russian first, then the English paragraph. Joined into one caption when the post goes out.
  @Column({ type: 'text', default: '' })
  textRu: string;

  @Column({ type: 'text', default: '' })
  textEn: string;

  // PromoAsset ids, in the order they are attached.
  @Column({ type: 'jsonb', default: () => `'[]'` })
  assetIds: number[];

  @Column({ type: 'varchar', length: 16, default: 'auto' })
  mode: PromoMode;

  @Index()
  @Column({ type: 'timestamp', nullable: true })
  scheduledAt: Date | null;

  @Index()
  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: PromoPostStatus;

  // Where the published post can be seen (filled in by hand for a reminder, by the publisher for an automatic post).
  @Column({ type: 'varchar', length: 500, nullable: true })
  externalUrl: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'timestamp', nullable: true })
  publishedAt: Date | null;

  // utm_campaign for the links in this post, so the site can tell where a visit came from.
  @Column({ type: 'varchar', length: 64, nullable: true })
  utmCampaign: string | null;
}
