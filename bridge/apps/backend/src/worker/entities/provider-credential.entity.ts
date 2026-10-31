import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  type ValueTransformer,
} from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { encryptedColumn } from '../../crypto/encrypted-column.transformer';
import { User } from '../../users/entities/user.entity';

// The models that run through an OpenAI-compatible API (Claude has its own ClaudeCredential). 'custom' is any other server —
// Yandex AI Studio, Gemini, Ollama… — and unlike the three named ones a custom key is never a default: a job names it.
export const PROVIDER_MODELS = ['gpt', 'deepseek', 'qwen', 'custom'] as const;
export type ProviderModel = (typeof PROVIDER_MODELS)[number];

// How the worker sends a request to the key's server (worker/src/routing.ts decides at request time):
//  - auto: a private address goes direct, a public one through the worker's VPN when it has one;
//  - vpn: always through the worker's VPN — a worker without one refuses the run;
//  - direct: never through it.
export const PROVIDER_ROUTES = ['auto', 'vpn', 'direct'] as const;
export type ProviderRoute = (typeof PROVIDER_ROUTES)[number];

// How the key goes into the request: 'Authorization: Bearer', 'Authorization: Api-Key' (Yandex Cloud), or not at all (a local server).
export const PROVIDER_AUTH_SCHEMES = ['bearer', 'api-key', 'none'] as const;
export type ProviderAuthScheme = (typeof PROVIDER_AUTH_SCHEMES)[number];

// A JSON object of header name → value, encrypted at rest like the key itself (it can hold a folder id or a second token).
export const encryptedHeadersColumn: ValueTransformer = {
  to(value: Record<string, string> | null | undefined) {
    if (value === null || value === undefined) return value;

    return encryptedColumn.to(JSON.stringify(value));
  },
  from(value: string | null | undefined): Record<string, string> | null {
    if (value === null || value === undefined) return null;

    try {
      const parsed: unknown = JSON.parse(encryptedColumn.from(value) as string);

      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, string>)
        : null;
    } catch {
      return null;
    }
  },
};

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

  // Empty for a local server that needs none (authScheme 'none').
  @Column({ type: 'text', transformer: encryptedColumn })
  apiKey: string;

  // Overrides the provider's default endpoint / model; null = the worker's built-in defaults.
  @Column({ type: 'varchar', length: 500, nullable: true })
  baseUrl: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string | null;

  // --- 'custom' keys; the defaults below are what gpt/deepseek/qwen keys always had ---

  @Column({ type: 'varchar', length: 8, default: 'auto' })
  route: ProviderRoute;

  @Column({ type: 'varchar', length: 8, default: 'bearer' })
  authScheme: ProviderAuthScheme;

  @Column({ type: 'text', nullable: true, transformer: encryptedHeadersColumn })
  extraHeaders: Record<string, string> | null;

  // Seconds one request may take; null = the worker's 300.
  @Column({ type: 'int', nullable: true })
  timeoutSec: number | null;

  // false: the model cannot call functions, so it cannot run a job (it can still chat).
  @Column({ type: 'boolean', default: true })
  supportsTools: boolean;

  // Stream the answer in a chat (used from the chat phase on).
  @Column({ type: 'boolean', default: false })
  stream: boolean;

  // Price per million tokens, for a rough cost on the usage page; null for a local model.
  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  priceInPerMTok: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  priceOutPerMTok: string | null;

  // Which UI template the key was made from (yandex, gemini, ollama…), only for hints.
  @Column({ type: 'varchar', length: 32, nullable: true })
  preset: string | null;

  // Only these workers may use the key (it points at a server only they can reach); null = any.
  @Column({ type: 'int', array: true, nullable: true })
  allowedWorkerIds: number[] | null;
}
