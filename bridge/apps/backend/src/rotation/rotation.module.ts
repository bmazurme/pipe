import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { KeyCopyCheck } from './entities/key-copy-check.entity';
import { RotationItem } from './entities/rotation-item.entity';
import { ReencryptService } from './reencrypt.service';
import {
  RotationAgentController,
  RotationController,
} from './rotation.controller';
import { RotationService } from './rotation.service';

@Module({
  imports: [
    AuthModule,
    TelegramModule,
    TypeOrmModule.forFeature([RotationItem, KeyCopyCheck]),
  ],
  controllers: [RotationController, RotationAgentController],
  providers: [RotationService, ReencryptService],
})
export class RotationModule {}
