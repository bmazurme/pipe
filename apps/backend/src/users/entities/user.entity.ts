import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../base.entity';

@Entity({ name: 'users' })
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 255, unique: true, nullable: false })
  email: string;

  @Column({ type: 'boolean', default: false, nullable: false })
  isActive: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  status: string;
}
