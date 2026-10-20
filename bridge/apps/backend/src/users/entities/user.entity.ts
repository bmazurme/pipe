import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { encryptedColumn } from '../../crypto/encrypted-column.transformer';

@Entity({ name: 'users' })
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 255, unique: true, nullable: false })
  email: string;

  @Column({ type: 'boolean', default: false, nullable: false })
  isActive: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  status: string;

  // select: false keeps the (up to 200k chars of) draft out of every ordinary
  // user lookup; getPurgeDraft selects it explicitly.
  @Column({
    type: 'text',
    nullable: true,
    select: false,
    transformer: encryptedColumn,
  })
  purgeDraft: string | null;
}
