import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

import { Session } from './auth/entities/session.entity';
import { PurgeEntry } from './purge/entities/purge-entry.entity';
import { StoredFile } from './storage/entities/stored-file.entity';
import { User } from './users/entities/user.entity';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: +(process.env.POSTGRES_PORT ?? '5432'),
  username: process.env.POSTGRES_USER ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD ?? 'postgres',
  database: process.env.POSTGRES_DB ?? 'ntlstl-db',
  entities: [User, StoredFile, PurgeEntry, Session],
  migrations: ['src/migrations/*.ts'],
});
