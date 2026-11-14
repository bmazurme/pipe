import { Column, Entity, PrimaryColumn } from 'typeorm';

// A channel or group the bot has been seen in (added, promoted, or a message arrived there). Not a setting: it is the list the promo
// module offers when the owner binds «the news channel» and «the discussion group», so nobody has to look a chat id up by hand.
@Entity({ name: 'telegram_chats' })
export class TelegramChat {
  // Telegram's own id, as text (channels and supergroups are -100…, beyond what a JS number keeps exactly in some drivers).
  @PrimaryColumn({ type: 'varchar', length: 32 })
  chatId: string;

  // channel | supergroup | group
  @Column({ type: 'varchar', length: 16 })
  type: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  username: string | null;

  // The bot's own status there as of the last my_chat_member update: creator | administrator | member | restricted | left | kicked.
  @Column({ type: 'varchar', length: 16, nullable: true })
  botStatus: string | null;

  @Column({ type: 'timestamp' })
  lastSeenAt: Date;
}
