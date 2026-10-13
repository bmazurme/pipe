import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { Chat } from './entities/chat.entity';
import { ChatAttachment } from './entities/chat-attachment.entity';
import { ChatMessage } from './entities/chat-message.entity';

@Module({
  imports: [
    AuthModule,
    StorageModule,
    TypeOrmModule.forFeature([Chat, ChatMessage, ChatAttachment]),
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
