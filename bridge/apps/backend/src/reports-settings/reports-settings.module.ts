import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { ReportsSettingsBackup } from './entities/reports-settings-backup.entity';
import { ReportsSettingsController } from './reports-settings.controller';
import { ReportsSettingsService } from './reports-settings.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([ReportsSettingsBackup])],
  controllers: [ReportsSettingsController],
  providers: [ReportsSettingsService],
})
export class ReportsSettingsModule {}
