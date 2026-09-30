import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { Chat } from './entities/chat.entity';
import { ChatMessage } from './entities/chat-message.entity';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Chat, ChatMessage])],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
