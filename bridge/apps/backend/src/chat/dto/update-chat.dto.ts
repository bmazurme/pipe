import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { ChatModel } from '../entities/chat.entity';

// At least one of the two is required; the controller checks that.
export class UpdateChatDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsEnum(ChatModel)
  model?: ChatModel;

  // With model 'custom': which stored key; on a custom chat alone it switches the server.
  @IsOptional()
  @IsInt()
  providerCredentialId?: number;
}
