import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../base.entity';

@Entity({ name: 'stored_files' })
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
}
