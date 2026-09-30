import { IsEnum } from 'class-validator';

import { ChatModel } from '../entities/chat.entity';

export class CreateChatDto {
  @IsEnum(ChatModel)
  model: ChatModel;
}
