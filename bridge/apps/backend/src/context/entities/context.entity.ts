import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { encryptedColumn } from '../../crypto/encrypted-column.transformer';
import { User } from '../../users/entities/user.entity';

// A named, reusable block of background text a user can attach to a Worker job —
// project conventions, constraints, notes from earlier runs. Nothing is attached
// by default: a job carries a context only when its owner picks one at launch.
@Entity({ name: 'contexts' })
@Index(['userId', 'name'], { unique: true })
export class Context extends BaseEntity {
  @Index()
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  // Free text that ends up in a model prompt, so it often holds project detail
  // the owner would not paste in public: encrypted at rest like the other
  // user-supplied text bridge keeps (see Secret.value).
  @Column({ type: 'text', transformer: encryptedColumn })
  content: string;

  // Length of `content`, kept beside it so a list can show the size without reading (and
  // decrypting) every context's full text. Null for a row saved before this existed; it is
  // filled in the next time the context is saved.
  @Column({ type: 'int', nullable: true })
  contentLength: number | null;
}
