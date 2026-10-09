import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

import { MAX_ATTACHMENTS_PER_MESSAGE } from '../attachments';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  content: string;

  // Files uploaded to this chat (POST chats/:id/attachments) to send with the message.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS_PER_MESSAGE)
  @IsInt({ each: true })
  attachmentIds?: number[];
}
