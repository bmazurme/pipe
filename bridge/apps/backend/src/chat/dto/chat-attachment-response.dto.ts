import { isImageAttachment } from '../attachments';
import { ChatAttachment } from '../entities/chat-attachment.entity';

export class ChatAttachmentResponseDto {
  id: number;
  name: string;
  size: number;
  isImage: boolean;
  // Null while the file is uploaded but its message has not been sent.
  messageId: number | null;

  static fromEntity(attachment: ChatAttachment): ChatAttachmentResponseDto {
    return {
      id: attachment.id,
      name: attachment.originalName,
      size: attachment.size,
      isImage: isImageAttachment(attachment.originalName),
      messageId: attachment.messageId,
    };
  }
}
