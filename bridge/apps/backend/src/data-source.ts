import './pg-timestamp-parser';

import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

import { ApiKey } from './auth/entities/api-key.entity';
import { Session } from './auth/entities/session.entity';
import { Chat } from './chat/entities/chat.entity';
import { ChatMessage } from './chat/entities/chat-message.entity';
import { PurgeEntry } from './purge/entities/purge-entry.entity';
import { StoredFile } from './storage/entities/stored-file.entity';
import { DayOff } from './time/entities/day-off.entity';
import { TimeReportEntry } from './time/entities/time-report-entry.entity';
import { User } from './users/entities/user.entity';
import { ClaudeCredential } from './worker/entities/claude-credential.entity';
import { Job } from './worker/entities/job.entity';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: +(process.env.POSTGRES_PORT ?? '5432'),
  username: process.env.POSTGRES_USER ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD ?? 'postgres',
  database: process.env.POSTGRES_DB ?? 'ntlstl-db',
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
  ],
  migrations: ['src/migrations/*.ts'],
});
