import { Column, Entity, PrimaryColumn } from 'typeorm';

export const TELEGRAM_ROLES = ['news', 'discussion'] as const;
export type TelegramRole = (typeof TELEGRAM_ROLES)[number];

// Where promo posts go: the channel for the project's news and the group for discussions (linked to the channel as its comments).
// One row per role — there is one owner and one of each.
@Entity({ name: 'promo_telegram_targets' })
export class PromoTelegramTarget {
  @PrimaryColumn({ type: 'varchar', length: 16 })
  role: TelegramRole;

  @Column({ type: 'varchar', length: 32 })
  chatId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string | null;

  // Public chats have one: it makes a link to a post. A private chat is linked as t.me/c/<id>/<message>.
  @Column({ type: 'varchar', length: 64, nullable: true })
  username: string | null;

  @Column({ type: 'timestamp' })
  boundAt: Date;
}
