import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { WorkerModule } from '../worker/worker.module';
import { RouterSettingsRow } from './entities/router-settings.entity';
import { RouterClassifierService } from './router-classifier.service';
import { RouterSettingsService } from './router-settings.service';
import { RouterController } from './router.controller';
import { RouterService } from './router.service';

@Module({
  imports: [
    AuthModule,
    ChatModule,
    WorkerModule,
    TypeOrmModule.forFeature([RouterSettingsRow]),
  ],
  controllers: [RouterController],
  providers: [RouterService, RouterSettingsService, RouterClassifierService],
  exports: [RouterService],
})
export class RouterModule {}
