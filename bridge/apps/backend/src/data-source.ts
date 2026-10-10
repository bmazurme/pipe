import './pg-timestamp-parser';

import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

import { ENTITIES } from './config/entities';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: +(process.env.POSTGRES_PORT ?? '5432'),
  username: process.env.POSTGRES_USER ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD ?? 'postgres',
  database: process.env.POSTGRES_DB ?? 'ntlstl-db',
  entities: ENTITIES,
  migrations: ['src/migrations/*.ts'],
});
