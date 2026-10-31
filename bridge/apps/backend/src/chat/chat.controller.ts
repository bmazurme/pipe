import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';

import { parseUpdatedAfter } from '../common/parse-updated-after';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { multerExceptionFilterFor } from '../uploads/multer-exception.filter';
import { MAX_ATTACHMENT_BYTES, sendAttachment } from './attachments';
import { attachmentMulterConfig } from './config/attachment-multer.config';
import { Chat } from './entities/chat.entity';
import { ListChatsQueryDto } from './dto/list-chats-query.dto';
import { ChatAttachmentsService } from './chat-attachments.service';
import { ChatService } from './chat.service';
import { ChatAttachmentResponseDto } from './dto/chat-attachment-response.dto';
import { ChatMessageResponseDto } from './dto/chat-message-response.dto';
import { ChatResponseDto } from './dto/chat-response.dto';
import { AttachRunResultDto } from './dto/attach-run-result.dto';
import { CreateChatDto } from './dto/create-chat.dto';
import { UpdateChatDto } from './dto/update-chat.dto';
import { SendMessageDto } from './dto/send-message.dto';

const AttachmentMulterExceptionFilter = multerExceptionFilterFor(
  MAX_ATTACHMENT_BYTES,
  (mb) => `Файл больше ${mb} МБ`,
);

// The browser's routes; worker's machine calls live in ChatTurnsController.
@Controller('api/v1/chat')
@UseGuards(JwtOrApiKeyGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatAttachments: ChatAttachmentsService,
  ) {}

  @Get('chats')
  async listChats(
    @CurrentUser() currentUser: { id: number },
    @Query() query: ListChatsQueryDto,
  ): Promise<ChatResponseDto[]> {
    const chats = await this.chatService.findAllByUser(currentUser.id, query.q);
    return chats.map(ChatResponseDto.fromEntity);
  }

  @Post('chats')
  async createChat(
    @Body() dto: CreateChatDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<ChatResponseDto> {
    const chat = await this.chatService.createChat(currentUser.id, dto);
    return ChatResponseDto.fromEntity(chat);
  }

  @Patch('chats/:id')
  async updateChat(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateChatDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<ChatResponseDto> {
    if (
      dto.title === undefined &&
      dto.model === undefined &&
      dto.providerCredentialId === undefined
    ) {
      throw new BadRequestException('Нужно указать название или модель');
    }

    let chat: Chat | undefined;
    if (dto.model !== undefined || dto.providerCredentialId !== undefined) {
      chat = await this.chatService.changeModel(
        id,
        currentUser.id,
        dto.model,
        dto.providerCredentialId,
      );
    }
    if (dto.title !== undefined) {
      chat = await this.chatService.renameChat(id, currentUser.id, dto.title);
    }
    return ChatResponseDto.fromEntity(chat as Chat);
  }

  @Post('chats/:id/run-results')
  async attachRunResult(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttachRunResultDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<ChatResponseDto> {
    const chat = await this.chatService.attachRunResult(
      id,
      currentUser.id,
      dto.jobId,
    );
    return ChatResponseDto.fromEntity(chat);
  }

  @Delete('chats/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeChat(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.chatService.removeChat(id, currentUser.id);
  }

  @Get('chats/:id/messages')
  async listMessages(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
    @Query('updatedAfter') updatedAfterRaw?: string,
  ): Promise<ChatMessageResponseDto[]> {
    const messages = await this.chatService.listMessages(
      id,
      currentUser.id,
      parseUpdatedAfter(updatedAfterRaw),
    );
    // Most polls while a reply is pending return nothing new: then no attachment query at all.
    if (messages.length === 0) return [];

    const attachments = await this.chatAttachments.attachmentsByMessage(
      messages.map((m) => m.id),
    );

    return messages.map((message) =>
      ChatMessageResponseDto.fromEntity(
        message,
        attachments.get(message.id) ?? [],
      ),
    );
  }

  // Upload first, then send the message with the returned ids — a file travels once, and
  // a failed or abandoned message leaves nothing half-attached.
  @Post('chats/:id/attachments')
  @UseFilters(AttachmentMulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', attachmentMulterConfig))
  async uploadAttachment(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() currentUser: { id: number },
  ): Promise<ChatAttachmentResponseDto> {
    if (!file) {
      throw new BadRequestException('Файл не передан');
    }

    const attachment = await this.chatAttachments.addAttachment(
      id,
      currentUser.id,
      file,
    );

    return ChatAttachmentResponseDto.fromEntity(attachment);
  }

  // The bytes of a file the user attached — for the preview in the conversation.
  @Get('attachments/:id/content')
  async attachmentContent(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
    @Res() res: Response,
  ): Promise<void> {
    const attachment = await this.chatAttachments.findOwnedAttachment(
      id,
      currentUser.id,
    );

    sendAttachment(res, attachment, this.chatAttachments);
  }

  // Takes back a file that was uploaded but not sent.
  @Delete('attachments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAttachment(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.chatAttachments.removeAttachment(id, currentUser.id);
  }

  @Post('chats/:id/messages')
  async sendMessage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendMessageDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<{
    userMessage: ChatMessageResponseDto;
    assistantMessage: ChatMessageResponseDto;
  }> {
    const { userMessage, assistantMessage, attachments } =
      await this.chatService.sendMessage(
        id,
        currentUser.id,
        dto.content,
        dto.attachmentIds,
      );

    return {
      userMessage: ChatMessageResponseDto.fromEntity(userMessage, attachments),
      assistantMessage: ChatMessageResponseDto.fromEntity(assistantMessage),
    };
  }

  @Post('messages/:id/retry')
  @HttpCode(HttpStatus.OK)
  async retryTurn(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<ChatMessageResponseDto> {
    const message = await this.chatService.retryTurn(id, currentUser.id);
    return ChatMessageResponseDto.fromEntity(message);
  }
}
