import './pg-timestamp-parser';

import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

import { ApiKey } from './auth/entities/api-key.entity';
import { Session } from './auth/entities/session.entity';
import { Chat } from './chat/entities/chat.entity';
import { ChatMessage } from './chat/entities/chat-message.entity';
import { ClientHeartbeat } from './loop/entities/client-heartbeat.entity';
import { LoopEvent } from './loop/entities/loop-event.entity';
import { LoopRun } from './loop/entities/loop-run.entity';
import { PurgeEntry } from './purge/entities/purge-entry.entity';
import { Secret } from './secrets/entities/secret.entity';
import { StoredFile } from './storage/entities/stored-file.entity';
import { DayOff } from './time/entities/day-off.entity';
import { TimeReportEntry } from './time/entities/time-report-entry.entity';
import { User } from './users/entities/user.entity';
import { VpnConnection } from './vpn/entities/vpn-connection.entity';
import { ClaudeCredential } from './worker/entities/claude-credential.entity';
import { Job } from './worker/entities/job.entity';
import { WorkerHeartbeat } from './worker/entities/worker-heartbeat.entity';

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
    VpnConnection,
    WorkerHeartbeat,
    Secret,
    LoopRun,
    LoopEvent,
    ClientHeartbeat,
  ],
  migrations: ['src/migrations/*.ts'],
});
