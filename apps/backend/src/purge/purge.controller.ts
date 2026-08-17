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
import { CreatePurgeEntryDto } from './dto/create-purge-entry.dto';
import { PurgeEntryResponseDto } from './dto/purge-entry-response.dto';
import { UpdatePurgeEntryDto } from './dto/update-purge-entry.dto';
import { PurgeService } from './purge.service';

@Controller('api/v1/purge')
@UseGuards(JwtGuard)
export class PurgeController {
  constructor(private readonly purgeService: PurgeService) {}

  @Get()
  async list(
    @CurrentUser() currentUser: { id: number },
  ): Promise<PurgeEntryResponseDto[]> {
    const entries = await this.purgeService.findAllByUser(currentUser.id);

    return entries.map(PurgeEntryResponseDto.fromEntity);
  }

  @Post()
  async create(
    @Body() dto: CreatePurgeEntryDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<PurgeEntryResponseDto> {
    const entry = await this.purgeService.create(currentUser.id, dto);

    return PurgeEntryResponseDto.fromEntity(entry);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePurgeEntryDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<PurgeEntryResponseDto> {
    const entry = await this.purgeService.update(id, currentUser.id, dto);

    return PurgeEntryResponseDto.fromEntity(entry);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.purgeService.delete(id, currentUser.id);
  }
}
