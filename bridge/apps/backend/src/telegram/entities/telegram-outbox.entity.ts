import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../base.entity';

// Notifications held back by quiet hours, waiting for the morning digest.
// Persisted (not an in-memory array) because a night is exactly when deploys
// and restarts happen — a restart must not swallow what accumulated.
@Entity({ name: 'telegram_outbox' })
export class TelegramOutbox extends BaseEntity {
  @Column({ type: 'text' })
  text: string;

  // JSON of the inline keyboard, for messages that carry buttons (the merge
  // offer) — those are re-sent individually in the morning, not folded into
  // the digest, so the buttons still work.
  @Column({ type: 'text', nullable: true })
  buttons: string | null;
}
