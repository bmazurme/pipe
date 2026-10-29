import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MachineOnly } from '../auth/decorators/machine-only.decorator';
import { WorkerKeyAllowed } from '../auth/decorators/worker-key-allowed.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { RunCredentialsService } from '../worker/run-credentials.service';
import { WorkersService } from '../worker/workers.service';
import { sendAttachment } from './attachments';
import { ChatAttachmentsService } from './chat-attachments.service';
import { ChatService } from './chat.service';
import { ChatMessageResponseDto } from './dto/chat-message-response.dto';
import { ClaimedTurnResponseDto } from './dto/claimed-turn-response.dto';
import { CompleteTurnDto } from './dto/complete-turn.dto';
import { FailTurnDto } from './dto/fail-turn.dto';
import { ReportProgressDto } from './dto/report-progress.dto';

// Worker's machine API for chat turns; the browser's routes are in ChatController.
@Controller('api/v1/chat/turns')
@UseGuards(JwtOrApiKeyGuard)
export class ChatTurnsController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatAttachments: ChatAttachmentsService,
    private readonly workersService: WorkersService,
    private readonly runCredentials: RunCredentialsService,
  ) {}

  @Post('claim')
  @MachineOnly()
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
  @Get(':messageId/attachments/:attachmentId')
  @WorkerKeyAllowed()
  async turnAttachment(
    @Param('messageId', ParseIntPipe) messageId: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @CurrentUser() currentUser: { id: number },
    @Res() res: Response,
  ): Promise<void> {
    const attachment = await this.chatAttachments.findAttachmentForTurn(
      messageId,
      attachmentId,
      currentUser.id,
    );

    sendAttachment(res, attachment, this.chatAttachments);
  }

  // The worker's live report of the reply so far; the chat page polls it.
  @Post(':messageId/progress')
  @WorkerKeyAllowed()
  @HttpCode(HttpStatus.NO_CONTENT)
  async reportProgress(
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() dto: ReportProgressDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.chatService.reportProgress(messageId, currentUser.id, dto.text);
  }

  @Post(':messageId/complete')
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
      dto.reasoning,
    );
    return ChatMessageResponseDto.fromEntity(message);
  }

  @Post(':messageId/fail')
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
