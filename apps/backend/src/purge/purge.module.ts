import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PurgeEntry } from './entities/purge-entry.entity';
import { PurgeController } from './purge.controller';
import { PurgeService } from './purge.service';

@Module({
  imports: [TypeOrmModule.forFeature([PurgeEntry])],
  controllers: [PurgeController],
  providers: [PurgeService],
})
export class PurgeModule {}
