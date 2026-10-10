import { join } from 'path';

import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { ENTITIES } from './entities';

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
      entities: ENTITIES,
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
