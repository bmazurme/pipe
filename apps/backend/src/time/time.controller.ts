import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { CreateDayOffDto } from './dto/create-day-off.dto';
import { DayOffResponseDto } from './dto/day-off-response.dto';
import { TimeService } from './time.service';

@Controller('api/v1/time')
@UseGuards(JwtGuard)
export class TimeController {
  constructor(private readonly timeService: TimeService) {}

  @Get('day-offs')
  async list(
    @Query('year', ParseIntPipe) year: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<DayOffResponseDto[]> {
    const entries = await this.timeService.findAllByUserAndYear(
      currentUser.id,
      year,
    );

    return entries.map(DayOffResponseDto.fromEntity);
  }

  @Post('day-offs')
  async create(
    @Body() dto: CreateDayOffDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<DayOffResponseDto> {
    const entry = await this.timeService.create(currentUser.id, dto.date);

    return DayOffResponseDto.fromEntity(entry);
  }

  @Delete('day-offs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.timeService.delete(id, currentUser.id);
  }
}
