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
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { ChatService } from './chat.service';
import { ChatMessageResponseDto } from './dto/chat-message-response.dto';
import { ChatResponseDto } from './dto/chat-response.dto';
import { ClaimedTurnResponseDto } from './dto/claimed-turn-response.dto';
import { CompleteTurnDto } from './dto/complete-turn.dto';
import { CreateChatDto } from './dto/create-chat.dto';
import { FailTurnDto } from './dto/fail-turn.dto';
import { RenameChatDto } from './dto/rename-chat.dto';
import { SendMessageDto } from './dto/send-message.dto';

// One controller, one guard, for both audiences — same reasoning as
// WorkerController: JwtOrApiKeyGuard already accepts a browser session or
// a personal API key, so the browser and worker's machine calls share every
// route's auth.
@Controller('api/v1/chat')
@UseGuards(JwtOrApiKeyGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

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
  ): Promise<ChatMessageResponseDto[]> {
    const messages = await this.chatService.listMessages(id, currentUser.id);
    return messages.map(ChatMessageResponseDto.fromEntity);
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
    const { userMessage, assistantMessage } =
      await this.chatService.sendMessage(id, currentUser.id, dto.content);

    return {
      userMessage: ChatMessageResponseDto.fromEntity(userMessage),
      assistantMessage: ChatMessageResponseDto.fromEntity(assistantMessage),
    };
  }

  // Worker-only from here down.

  @Post('turns/claim')
  async claim(
    @CurrentUser() currentUser: { id: number },
    @Res() res: Response,
  ): Promise<void> {
    const claimed = await this.chatService.claim(currentUser.id);

    // A bare `return null` sends a genuinely empty body (no content-type,
    // nothing for .json() to parse) rather than the JSON text "null" —
    // breaks a client that always calls response.json(). 204 is also the
    // more correct status for "nothing to claim" than 201.
    if (!claimed) {
      res.status(HttpStatus.NO_CONTENT).end();
      return;
    }

    const payload: ClaimedTurnResponseDto = {
      messageId: claimed.message.id,
      chatId: claimed.chat.id,
      model: claimed.chat.model,
      history: claimed.history,
    };

    res.status(HttpStatus.OK).json(payload);
  }

  @Post('turns/:messageId/complete')
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
