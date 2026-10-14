import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { encryptedColumn } from '../../crypto/encrypted-column.transformer';
import { User } from '../../users/entities/user.entity';

// The models that run through an OpenAI-compatible API (Claude has its own ClaudeCredential).
export const PROVIDER_MODELS = ['gpt', 'deepseek', 'qwen'] as const;
export type ProviderModel = (typeof PROVIDER_MODELS)[number];

// An API key for gpt / deepseek / qwen, kept here instead of in the worker's environment: the owner adds it in the UI
// and bridge hands it to whichever worker claims the job. Encrypted at rest like every other stored secret.
@Entity({ name: 'provider_credentials' })
export class ProviderCredential extends BaseEntity {
  @Index()
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 16 })
  provider: ProviderModel;

  // Human label ("personal", "team").
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', transformer: encryptedColumn })
  apiKey: string;

  // Overrides the provider's default endpoint / model; null = the worker's built-in defaults.
  @Column({ type: 'varchar', length: 500, nullable: true })
  baseUrl: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string | null;
}
