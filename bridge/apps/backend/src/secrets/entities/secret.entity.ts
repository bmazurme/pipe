import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { encryptedColumn } from '../../crypto/encrypted-column.transformer';
import { User } from '../../users/entities/user.entity';

// A personal secrets vault: arbitrary name/value pairs a user stores for
// themselves (API keys for other services, tokens, anything they'd
// otherwise park in a local .env). Unrelated to ClaudeCredential/
// VpnConnection — those are machine credentials this backend hands to
// worker; a Secret here is read back only by its own owner, through this
// module's own endpoints, never by worker or any other product.
@Entity({ name: 'secrets' })
@Index(['userId', 'name'], { unique: true })
export class Secret extends BaseEntity {
  @Index()
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  // Human label — unique per user so a listing (and the reveal/edit/delete
  // actions keyed off it in the UI) never has to disambiguate two rows with
  // the same name.
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  // Encrypted at rest (AES-256-GCM via encryptedColumn, same transformer as
  // ClaudeCredential.token/VpnConnection.panelApiToken) — a DB dump or
  // pgadmin access no longer hands over a usable secret.
  @Column({ type: 'text', transformer: encryptedColumn })
  value: string;
}
