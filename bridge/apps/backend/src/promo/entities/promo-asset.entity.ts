import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../base.entity';

// A picture or a video a post carries. The bytes live in the FileStore under `promo/<storedName>` (the local volume or a bucket),
// the row keeps what a listing needs.
@Entity({ name: 'promo_assets' })
export class PromoAsset extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  originalName: string;

  @Column({ type: 'varchar', length: 100 })
  mime: string;

  @Column({ type: 'int' })
  size: number;

  @Column({ type: 'varchar', length: 255 })
  storedName: string;
}
