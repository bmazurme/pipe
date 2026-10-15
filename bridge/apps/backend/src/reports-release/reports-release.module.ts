import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { LoopModule } from '../loop/loop.module';
import { ReportsReleaseController } from './reports-release.controller';
import { ReportsReleaseService } from './reports-release.service';

@Module({
  imports: [AuthModule, LoopModule],
  controllers: [ReportsReleaseController],
  providers: [ReportsReleaseService],
})
export class ReportsReleaseModule {}
