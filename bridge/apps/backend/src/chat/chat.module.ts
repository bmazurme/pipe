import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { ContextModule } from '../context/context.module';
import { StorageModule } from '../storage/storage.module';
import { WorkerModule } from '../worker/worker.module';
import { ChatAttachmentsService } from './chat-attachments.service';
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
    TypeOrmModule.forFeature([Chat, ChatMessage, ChatAttachment]),
  ],
  controllers: [ChatController, ChatTurnsController],
  providers: [ChatService, ChatAttachmentsService],
})
export class ChatModule {}
