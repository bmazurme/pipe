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

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { WorkerKeyAllowed } from '../auth/decorators/worker-key-allowed.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { multerExceptionFilterFor } from '../uploads/multer-exception.filter';
import { contentTypeOf, MAX_ATTACHMENT_BYTES } from './attachments';
import { attachmentMulterConfig } from './config/attachment-multer.config';
import { ChatAttachment } from './entities/chat-attachment.entity';
import { RunCredentialsService } from '../worker/run-credentials.service';
import { WorkersService } from '../worker/workers.service';
import { ChatService } from './chat.service';
import { ChatAttachmentResponseDto } from './dto/chat-attachment-response.dto';
import { ChatMessageResponseDto } from './dto/chat-message-response.dto';
import { ChatResponseDto } from './dto/chat-response.dto';
import { ClaimedTurnResponseDto } from './dto/claimed-turn-response.dto';
import { ReportProgressDto } from './dto/report-progress.dto';
import { CompleteTurnDto } from './dto/complete-turn.dto';
import { CreateChatDto } from './dto/create-chat.dto';
import { FailTurnDto } from './dto/fail-turn.dto';
import { RenameChatDto } from './dto/rename-chat.dto';
import { SendMessageDto } from './dto/send-message.dto';

const AttachmentMulterExceptionFilter = multerExceptionFilterFor(
  MAX_ATTACHMENT_BYTES,
  (mb) => `Файл больше ${mb} МБ`,
);

function parseUpdatedAfter(raw: string | undefined): Date | undefined {
  if (raw === undefined) return undefined;

  const value = new Date(raw);

  if (Number.isNaN(value.getTime())) {
    throw new BadRequestException('updatedAfter must be a valid date');
  }

  return value;
}

// One controller, one guard, for both audiences — same reasoning as
// WorkerController: JwtOrApiKeyGuard already accepts a browser session or
// a personal API key, so the browser and worker's machine calls share every
// route's auth.
@Controller('api/v1/chat')
@UseGuards(JwtOrApiKeyGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly workersService: WorkersService,
    private readonly runCredentials: RunCredentialsService,
  ) {}

  @Get('chats')
  async listChats(
    @CurrentUser() currentUser: { id: number },
  ): Promise<ChatResponseDto[]> {
    const chats = await this.chatService.findAllByUser(currentUser.id);
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
  async renameChat(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RenameChatDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<ChatResponseDto> {
    const chat = await this.chatService.renameChat(
      id,
      currentUser.id,
      dto.title,
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

    const attachments = await this.chatService.attachmentsByMessage(
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

    const attachment = await this.chatService.addAttachment(
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
    const attachment = await this.chatService.findOwnedAttachment(
      id,
      currentUser.id,
    );

    this.sendAttachment(res, attachment);
  }

  // Takes back a file that was uploaded but not sent.
  @Delete('attachments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAttachment(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.chatService.removeAttachment(id, currentUser.id);
  }

  private sendAttachment(res: Response, attachment: ChatAttachment): void {
    const name = attachment.originalName;

    res.setHeader('Content-Type', contentTypeOf(name));
    // Never rendered as a page: an uploaded .html must not run in bridge's origin.
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    this.chatService.sendAttachment(res, attachment, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ message: 'File is missing' });
      }
    });
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

  // Worker-only from here down.

  @Post('turns/claim')
  @WorkerKeyAllowed()
  async claim(
    @CurrentUser() currentUser: { id: number; workerId?: number },
    @Res() res: Response,
  ): Promise<void> {
    // A worker added in the UI may be paused or have chat switched off — then it is simply given nothing.
    const mayTake =
      currentUser.workerId === undefined ||
      (await this.workersService.mayTakeChatTurn(currentUser.workerId));
    const claimed = mayTake
      ? await this.chatService.claim(currentUser.id)
      : null;

    // A bare `return null` sends a genuinely empty body (no content-type,
    // nothing for .json() to parse) rather than the JSON text "null" —
    // breaks a client that always calls response.json(). 204 is also the
    // more correct status for "nothing to claim" than 201.
    if (!claimed) {
      res.status(HttpStatus.NO_CONTENT).end();
      return;
    }

    let resolved: Awaited<ReturnType<RunCredentialsService['resolve']>>;

    try {
      resolved = await this.runCredentials.resolve(
        currentUser.id,
        currentUser.workerId,
        claimed.chat.model,
      );
    } catch (error) {
      // The row is already Running; without this it would stay "thinking" forever.
      await this.chatService
        .failTurn(
          claimed.message.id,
          currentUser.id,
          `Не удалось получить доступ к модели: ${error instanceof Error ? error.message : String(error)}`,
        )
        .catch(() => undefined);
      throw error;
    }

    const { claudeToken, provider } = resolved;

    const payload: ClaimedTurnResponseDto = {
      messageId: claimed.message.id,
      chatId: claimed.chat.id,
      model: claimed.chat.model,
      provider,
      claudeToken,
      context: claimed.chat.contextText ?? null,
      history: claimed.history,
    };

    res.status(HttpStatus.OK).json(payload);
  }

  // The worker fetches each file of a turn's history here, one request per file.
  @Get('turns/:messageId/attachments/:attachmentId')
  @WorkerKeyAllowed()
  async turnAttachment(
    @Param('messageId', ParseIntPipe) messageId: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @CurrentUser() currentUser: { id: number },
    @Res() res: Response,
  ): Promise<void> {
    const attachment = await this.chatService.findAttachmentForTurn(
      messageId,
      attachmentId,
      currentUser.id,
    );

    this.sendAttachment(res, attachment);
  }

  // The worker's live report of the reply so far; the chat page polls it.
  @Post('turns/:messageId/progress')
  @WorkerKeyAllowed()
  @HttpCode(HttpStatus.NO_CONTENT)
  async reportProgress(
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() dto: ReportProgressDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.chatService.reportProgress(messageId, currentUser.id, dto.text);
  }

  @Post('turns/:messageId/complete')
  @WorkerKeyAllowed()
  async completeTurn(
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() dto: CompleteTurnDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<ChatMessageResponseDto> {
    const message = await this.chatService.completeTurn(
      messageId,
      currentUser.id,
      dto.content,
    );
    return ChatMessageResponseDto.fromEntity(message);
  }

  @Post('turns/:messageId/fail')
  @WorkerKeyAllowed()
  async failTurn(
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() dto: FailTurnDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<ChatMessageResponseDto> {
    const message = await this.chatService.failTurn(
      messageId,
      currentUser.id,
      dto.errorMessage,
    );
    return ChatMessageResponseDto.fromEntity(message);
  }
}
