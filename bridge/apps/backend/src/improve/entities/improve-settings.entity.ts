import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

// Per-account switches of the Improve module.
@Entity({ name: 'improve_settings' })
export class ImproveSettings {
  @PrimaryColumn({ type: 'int', unsigned: true })
  userId: number;

  // When set, every unencrypted issue parcel that reaches Storage (a Subscription
  // push from reports) is handed to the worker with this model at once, instead
  // of waiting for someone to press "Запустить" on the Worker page.
  @Column({ type: 'varchar', length: 16, nullable: true })
  autoStartModel: string | null;

  // Parcels uploaded before this moment are never auto-started — switching the
  // feature on must not suddenly run everything already sitting in Storage.
  @Column({ type: 'timestamp', nullable: true })
  autoStartSince: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
