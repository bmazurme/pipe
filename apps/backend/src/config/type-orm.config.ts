import { join } from 'path';

import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { Session } from '../auth/entities/session.entity';
import { PurgeEntry } from '../purge/entities/purge-entry.entity';
import { StoredFile } from '../storage/entities/stored-file.entity';
import { DayOff } from '../time/entities/day-off.entity';
import { User } from '../users/entities/user.entity';

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
      entities: [User, StoredFile, PurgeEntry, Session, DayOff],
      synchronize: isDev,
      migrations: isDev ? [] : [join(__dirname, '../migrations/*.js')],
      migrationsRun: !isDev,
    };
  },
  inject: [ConfigService],
});
