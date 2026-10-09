import {
  BadRequestException,
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
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { reportImportMulterConfig } from './config/report-import-multer.config';
import { CreateDayOffDto } from './dto/create-day-off.dto';
import { DayOffResponseDto } from './dto/day-off-response.dto';
import { ImportTimeReportResponseDto } from './dto/import-time-report-response.dto';
import { TimeReportEntryResponseDto } from './dto/time-report-entry-response.dto';
import { ReportImportMulterExceptionFilter } from './filters/report-import-multer-exception.filter';
import { monthPipe, yearPipe } from './pipes/parse-bounded-int.pipe';
import { TimeService } from './time.service';

@Controller('api/v1/time')
@UseGuards(JwtGuard)
export class TimeController {
  constructor(private readonly timeService: TimeService) {}

  @Get('day-offs')
  async list(
    @Query('year', yearPipe()) year: number,
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
    const entry = await this.timeService.create(
      currentUser.id,
      dto.date,
      dto.type,
    );

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

  @Get('reports')
  async listReports(
    @Query('year', yearPipe()) year: number,
    @Query('month', monthPipe()) month: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<TimeReportEntryResponseDto[]> {
    const entries = await this.timeService.findReportEntries(
      currentUser.id,
      year,
      month,
    );

    return entries.map(TimeReportEntryResponseDto.fromEntity);
  }

  @Delete('reports')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteReports(
    @Query('year', yearPipe()) year: number,
    @Query('month', monthPipe()) month: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.timeService.deleteReportEntries(currentUser.id, year, month);
  }

  @Post('reports/import')
  @UseFilters(ReportImportMulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', reportImportMulterConfig))
  async importReport(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() currentUser: { id: number },
  ): Promise<ImportTimeReportResponseDto> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    return this.timeService.importReport(currentUser.id, file);
  }
}
