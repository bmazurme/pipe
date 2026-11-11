import { Column, Entity, PrimaryColumn } from 'typeorm';

// A condition about the channels that was announced on Telegram and has not been announced as over yet. Kept in the database so that a
// restart (a release rolls out every few minutes) does not announce a condition that is still there a second time.
@Entity({ name: 'link_alerts' })
export class LinkAlert {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  key: string;

  @Column({ type: 'timestamp' })
  since: Date;

  // What to say when the condition ends (it may mention a channel that is gone from the pool by then).
  @Column({ type: 'varchar', length: 500 })
  recovered: string;
}
