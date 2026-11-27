import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BoardsModule } from '../boards/boards.module';
import { ImproveRun } from '../improve/entities/improve-run.entity';
import { ContextModule } from '../context/context.module';
import { StorageModule } from '../storage/storage.module';
import { Job } from '../worker/entities/job.entity';
import { Worker } from '../worker/entities/worker.entity';
import { WorkerModule } from '../worker/worker.module';
import { ChatAttachmentsService } from './chat-attachments.service';
import { ChatSystemFactsService } from './chat-system-facts.service';
import { ChatToolsController } from './chat-tools.controller';
import { ChatController } from './chat.controller';
import { ChatTurnsController } from './chat-turns.controller';
import { ChatService } from './chat.service';
import { Chat } from './entities/chat.entity';
import { ChatAttachment } from './entities/chat-attachment.entity';
import { ChatMessage } from './entities/chat-message.entity';

@Module({
  imports: [
    AuthModule,
    ContextModule,
    StorageModule,
    WorkerModule,
    BoardsModule,
    TypeOrmModule.forFeature([
      Chat,
      ChatMessage,
      ChatAttachment,
      ImproveRun,
      Job,
      Worker,
    ]),
  ],
  controllers: [ChatController, ChatTurnsController, ChatToolsController],
  providers: [ChatService, ChatAttachmentsService, ChatSystemFactsService],
  // The model router asks a short question of Haiku through a chat of its own.
  exports: [ChatService],
})
export class ChatModule {}
