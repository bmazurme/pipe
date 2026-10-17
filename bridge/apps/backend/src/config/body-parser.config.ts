import type { NestExpressApplication } from '@nestjs/platform-express';

// Express's default 100 kb is too small for a chat turn's final reply, which a worker posts whole in one JSON body
// (MAX_REPLY_LENGTH characters — up to ~1 MB of Cyrillic, more with escaped quotes/newlines); past it bridge answered
// 413 before validation and the already generated reply was lost. The per-field caps (MaxLength on the DTOs) stay the
// real limits; this only has to sit above them.
export const JSON_BODY_LIMIT = '2mb';

// Registered through Nest rather than plain app.use(express.json()), so `rawBody: true` from NestFactory.create still
// keeps the exact bytes GithubWebhookController checks the signature against.
export function configureBodyParsers(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: JSON_BODY_LIMIT, extended: true });
}
