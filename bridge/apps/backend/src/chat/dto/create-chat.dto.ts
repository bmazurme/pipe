import { IsEnum, IsInt, IsOptional } from 'class-validator';

import { ChatModel } from '../entities/chat.entity';

export class CreateChatDto {
  @IsEnum(ChatModel)
  model: ChatModel;

  // A saved Context to attach; its text is snapshotted into the chat at creation.
  @IsOptional()
  @IsInt()
  contextId?: number;
}
