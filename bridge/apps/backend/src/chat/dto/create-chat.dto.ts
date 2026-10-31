import { IsEnum, IsInt, IsOptional } from 'class-validator';

import { ChatModel } from '../entities/chat.entity';

export class CreateChatDto {
  @IsEnum(ChatModel)
  model: ChatModel;

  // For a custom model: the stored key of the server to run on (required there, ignored otherwise).
  @IsOptional()
  @IsInt()
  providerCredentialId?: number;

  // A saved Context to attach; its text is snapshotted into the chat at creation.
  @IsOptional()
  @IsInt()
  contextId?: number;
}
