import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
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
    );

    return {
      id: question.id,
      text: question.text,
      resolved: question.resolvedAt !== null,
      createdAt: question.createdAt,
    };
  }
}
