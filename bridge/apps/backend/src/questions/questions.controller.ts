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
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { QuestionCardDto, QuestionItemDto } from './dto/question-card.dto';
import { ResolveQuestionDto } from './dto/resolve-question.dto';
import { QuestionsService } from './questions.service';

// Browser session only: the worker reports questions through its own job route (see WorkerController), never here.
@Controller('api/v1/questions')
@UseGuards(JwtGuard)
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  // `?archived=true` lists the cards whose questions are all resolved; by default the ones with something still open.
  @Get()
  async list(
    @CurrentUser() currentUser: { id: number },
    @Query('archived') archived?: string,
  ): Promise<QuestionCardDto[]> {
    return this.questionsService.listCards(currentUser.id, archived === 'true');
  }

  @Patch(':id')
  async resolve(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveQuestionDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<QuestionItemDto> {
    const question = await this.questionsService.setResolved(
      id,
      currentUser.id,
      dto.resolved,
      dto.answer,
    );

    return QuestionItemDto.fromEntity(question);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.questionsService.remove(id, currentUser.id);
  }

  // The whole card: every question of the task.
  @Delete('cards/:taskKey')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeCard(
    @Param('taskKey') taskKey: string,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.questionsService.removeCard(currentUser.id, taskKey);
  }

  @Post('cards/:taskKey/context')
  async saveAsContext(
    @Param('taskKey') taskKey: string,
    @CurrentUser() currentUser: { id: number },
  ): Promise<{ contextId: number; updated: boolean }> {
    return this.questionsService.createContext(currentUser.id, taskKey);
  }
}
