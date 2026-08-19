import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import { ImportTimeReportResponseDto } from './dto/import-time-report-response.dto';
import { TimeReportEntryResponseDto } from './dto/time-report-entry-response.dto';
import { DayOff, DayOffType } from './entities/day-off.entity';
import { TimeReportEntry } from './entities/time-report-entry.entity';
import {
  extractPeriodFromFilename,
  parseTimeReportWorkbook,
} from './time-report-import.util';

@Injectable()
export class TimeService {
  constructor(
    @InjectRepository(DayOff)
    private readonly dayOffRepository: Repository<DayOff>,
    @InjectRepository(TimeReportEntry)
    private readonly timeReportEntryRepository: Repository<TimeReportEntry>,
  ) {}

  async findAllByUserAndYear(userId: number, year: number): Promise<DayOff[]> {
    return this.dayOffRepository.find({
      where: { userId, date: Between(`${year}-01-01`, `${year}-12-31`) },
      order: { date: 'ASC' },
    });
  }

  async create(
    userId: number,
    date: string,
    type: DayOffType = DayOffType.Off,
  ): Promise<DayOff> {
    const existing = await this.dayOffRepository.findOne({
      where: { userId, date },
    });

    if (existing) {
      throw new BadRequestException(`Day off for ${date} already exists`);
    }

    return this.dayOffRepository.save({ userId, date, type });
  }

  async delete(id: number, userId: number): Promise<void> {
    const entry = await this.dayOffRepository.findOne({
      where: { id, userId },
    });

    if (!entry) {
      throw new NotFoundException('Day off not found');
    }

    await this.dayOffRepository.delete(entry.id);
  }

  async findReportEntries(
    userId: number,
    year: number,
    month: number,
  ): Promise<TimeReportEntry[]> {
    return this.timeReportEntryRepository.find({
      where: { userId, year, month },
      order: { id: 'ASC' },
    });
  }

  async importReport(
    userId: number,
    file: Express.Multer.File,
  ): Promise<ImportTimeReportResponseDto> {
    const period = extractPeriodFromFilename(file.originalname);

    if (!period) {
      throw new BadRequestException(
        'Не удалось определить год и месяц из названия файла',
      );
    }

    const parsedEntries = await parseTimeReportWorkbook(file.buffer);

    if (parsedEntries.length === 0) {
      throw new BadRequestException('В файле не найдено ни одной задачи');
    }

    // Re-importing the same period replaces its rows outright rather than
    // merging — the source file is the CRM export, so the latest upload is
    // always the source of truth for that month.
    await this.timeReportEntryRepository.delete({
      userId,
      year: period.year,
      month: period.month,
    });

    const entries = await this.timeReportEntryRepository.save(
      parsedEntries.map((entry) => ({
        userId,
        year: period.year,
        month: period.month,
        ...entry,
      })),
    );

    return {
      year: period.year,
      month: period.month,
      entries: entries.map(TimeReportEntryResponseDto.fromEntity),
    };
  }
}
