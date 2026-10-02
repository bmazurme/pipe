import { join } from 'path';

import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { ApiKey } from '../auth/entities/api-key.entity';
import { Session } from '../auth/entities/session.entity';
import { Chat } from '../chat/entities/chat.entity';
import { ChatMessage } from '../chat/entities/chat-message.entity';
import { PurgeEntry } from '../purge/entities/purge-entry.entity';
import { StoredFile } from '../storage/entities/stored-file.entity';
import { DayOff } from '../time/entities/day-off.entity';
import { TimeReportEntry } from '../time/entities/time-report-entry.entity';
import { User } from '../users/entities/user.entity';
import { ClaudeOauthCredential } from '../vpn/entities/claude-oauth-credential.entity';
import { Job } from '../worker/entities/job.entity';

export const TypeOrmModuleConfig = TypeOrmModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (configService: ConfigService) => {
    const isDev = configService.get('NODE_ENV') !== 'production';

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
        ClaudeOauthCredential,
      ],
      synchronize: isDev,
      migrations: isDev ? [] : [join(__dirname, '../migrations/*.js')],
      migrationsRun: !isDev,
    };
  },
  inject: [ConfigService],
});
