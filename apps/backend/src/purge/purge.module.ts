import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '../users/users.module';
import { PurgeEntry } from './entities/purge-entry.entity';
import { PurgeController } from './purge.controller';
import { PurgeService } from './purge.service';

@Module({
  imports: [TypeOrmModule.forFeature([PurgeEntry]), UsersModule],
  controllers: [PurgeController],
  providers: [PurgeService],
})
export class PurgeModule {}
