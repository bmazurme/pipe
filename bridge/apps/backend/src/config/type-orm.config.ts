import { join } from 'path';

import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { ApiKey } from '../auth/entities/api-key.entity';
import { Session } from '../auth/entities/session.entity';
import { Chat } from '../chat/entities/chat.entity';
import { ChatMessage } from '../chat/entities/chat-message.entity';
import { AppLog } from '../logs/entities/app-log.entity';
import { ClientHeartbeat } from '../loop/entities/client-heartbeat.entity';
import { LoopEvent } from '../loop/entities/loop-event.entity';
import { LoopRun } from '../loop/entities/loop-run.entity';
import { PurgeEntry } from '../purge/entities/purge-entry.entity';
import { Secret } from '../secrets/entities/secret.entity';
import { NotificationSettings } from '../telegram/entities/notification-settings.entity';
import { TelegramOutbox } from '../telegram/entities/telegram-outbox.entity';
import { StoredFile } from '../storage/entities/stored-file.entity';
import { DayOff } from '../time/entities/day-off.entity';
import { TimeReportEntry } from '../time/entities/time-report-entry.entity';
import { User } from '../users/entities/user.entity';
import { VpnConnection } from '../vpn/entities/vpn-connection.entity';
import { ClaudeCredential } from '../worker/entities/claude-credential.entity';
import { Job } from '../worker/entities/job.entity';
import { WorkerHeartbeat } from '../worker/entities/worker-heartbeat.entity';

export const TypeOrmModuleConfig = TypeOrmModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (configService: ConfigService) => {
    return {
      type: 'postgres' as const,
      host: configService.get<string>('POSTGRES_HOST') ?? 'localhost',
      port: +(configService.get<string>('POSTGRES_PORT') ?? '5432'),
      username: configService.get<string>('POSTGRES_USER') ?? 'postgres',
      password: configService.get<string>('POSTGRES_PASSWORD') ?? 'postgres',
      database: configService.get<string>('POSTGRES_DB') ?? 'ntlstl-db',
      entities: [
        User,
        StoredFile,
        PurgeEntry,
        Session,
        ApiKey,
        DayOff,
        TimeReportEntry,
        Job,
        Chat,
        ChatMessage,
        ClaudeCredential,
        VpnConnection,
        WorkerHeartbeat,
        Secret,
        LoopRun,
        LoopEvent,
        ClientHeartbeat,
        TelegramOutbox,
        NotificationSettings,
        AppLog,
      ],
      // Dev used to run on synchronize: true (schema auto-matched to
      // entities, no migration files involved at all) — real migrations now
      // run everywhere, dev included, so the schema a developer actually
      // runs against can't silently drift from what's committed (see
      // IMPROVEMENTS_TECH.md 5.4). `nest start --watch` transpiles to the
      // same dist/ this points at, same as a prod build, so the glob below
      // resolves in both. An existing dev DB built under the old
      // synchronize: true has tables but no migrations-run history — it
      // needs recreating once (drop the db / docker volume) before this
      // works there; a fresh one just works.
      synchronize: false,
      // `.js` for a real build (nest start/nest build both transpile to
      // dist/, where this file's own __dirname actually lives); `.ts` for
      // the e2e suite, which runs straight off src/ through ts-jest's
      // require hook instead of a dist/ build — __dirname there is src/config,
      // and the migration files sitting next to it are still .ts.
      migrations: [join(__dirname, '../migrations/*.{js,ts}')],
      migrationsRun: true,
    };
  },
  inject: [ConfigService],
});
