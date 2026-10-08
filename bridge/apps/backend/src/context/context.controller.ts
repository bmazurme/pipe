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
import { ContextService } from './context.service';
import { ContextResponseDto } from './dto/context-response.dto';
import { CreateContextDto } from './dto/create-context.dto';
import { UpdateContextDto } from './dto/update-context.dto';

// Browser session only, like the other personal modules: a worker never reads a
// context from here — the text it needs is snapshotted onto the job and handed
// over when the job is claimed.
@Controller('api/v1/contexts')
@UseGuards(JwtGuard)
export class ContextController {
  constructor(private readonly contextService: ContextService) {}

  @Get()
  async list(
    @CurrentUser() currentUser: { id: number },
  ): Promise<ContextResponseDto[]> {
    const contexts = await this.contextService.findAllByUser(currentUser.id);

    return contexts.map(ContextResponseDto.fromEntity);
  }

  @Post()
  async create(
    @Body() dto: CreateContextDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<ContextResponseDto> {
    const context = await this.contextService.create(currentUser.id, dto);

    return ContextResponseDto.fromEntity(context);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateContextDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<ContextResponseDto> {
    const context = await this.contextService.update(id, currentUser.id, dto);

    return ContextResponseDto.fromEntity(context);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.contextService.delete(id, currentUser.id);
  }
}
