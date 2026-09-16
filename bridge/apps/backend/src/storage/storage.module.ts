import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { StoredFile } from './entities/stored-file.entity';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([StoredFile])],
  controllers: [StorageController],
  providers: [StorageService],
})
export class StorageModule {}
