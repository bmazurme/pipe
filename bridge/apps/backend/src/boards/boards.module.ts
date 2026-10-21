import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { BoardsAgentController, BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';
import { BoardReport } from './entities/board-report.entity';
import { ScriptUpdate } from './entities/script-update.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([BoardReport, ScriptUpdate]),
    AuthModule,
    TelegramModule,
  ],
  controllers: [BoardsAgentController, BoardsController],
  providers: [BoardsService],
  exports: [BoardsService],
})
export class BoardsModule {}
