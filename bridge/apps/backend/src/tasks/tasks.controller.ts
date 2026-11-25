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
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import {
  CreateCardDto,
  CreateColumnDto,
  MoveCardDto,
  TaskBoardResponseDto,
  TaskCardResponseDto,
  UpdateCardDto,
  UpdateColumnDto,
} from './dto/tasks.dto';
import { TasksService } from './tasks.service';

// Browser-only: a personal board the user manages from the frontend.
@Controller('api/v1/tasks')
@UseGuards(JwtGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get('board')
  board(@CurrentUser() user: { id: number }): Promise<TaskBoardResponseDto> {
    return this.tasksService.getBoard(user.id);
  }

  @Get('archive')
  archive(@CurrentUser() user: { id: number }): Promise<TaskCardResponseDto[]> {
    return this.tasksService.listArchive(user.id);
  }

  @Post('columns')
  createColumn(
    @Body() dto: CreateColumnDto,
    @CurrentUser() user: { id: number },
  ) {
    return this.tasksService.createColumn(user.id, dto.title);
  }

  @Patch('columns/:id')
  renameColumn(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateColumnDto,
    @CurrentUser() user: { id: number },
  ) {
    return this.tasksService.renameColumn(id, user.id, dto.title);
  }

  @Delete('columns/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteColumn(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
  ): Promise<void> {
    await this.tasksService.deleteColumn(id, user.id);
  }

  @Post('cards')
  createCard(
    @Body() dto: CreateCardDto,
    @CurrentUser() user: { id: number },
  ): Promise<TaskCardResponseDto> {
    return this.tasksService.createCard(user.id, dto);
  }

  @Patch('cards/:id')
  updateCard(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCardDto,
    @CurrentUser() user: { id: number },
  ): Promise<TaskCardResponseDto> {
    return this.tasksService.updateCard(id, user.id, dto);
  }

  @Post('cards/:id/move')
  @HttpCode(HttpStatus.OK)
  moveCard(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MoveCardDto,
    @CurrentUser() user: { id: number },
  ): Promise<TaskBoardResponseDto> {
    return this.tasksService.moveCard(id, user.id, dto);
  }

  @Delete('cards/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCard(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
  ): Promise<void> {
    await this.tasksService.deleteCard(id, user.id);
  }
}
