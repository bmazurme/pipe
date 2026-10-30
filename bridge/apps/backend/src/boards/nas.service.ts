import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NasReportDto } from './dto/nas.dto';
import { NasReport } from './entities/nas-report.entity';
import { assessNas, NasAssessment, NasData } from './nas';

export interface NasView extends NasAssessment {
  host: string;
  reportedAt: string;
  data: NasData;
}

@Injectable()
export class NasService {
  constructor(
    @InjectRepository(NasReport)
    private readonly reports: Repository<NasReport>,
  ) {}

  // The NAS's own account of itself. Only the latest is kept: the Dashboard shows now, not history.
  async record(userId: number, dto: NasReportDto): Promise<void> {
    await this.reports.upsert(
      {
        userId,
        host: dto.host,
        reportedAt: new Date(),
        data: dto as unknown as NasData,
      },
      ['userId', 'host'],
    );
  }

  async list(userId: number, now = new Date()): Promise<NasView[]> {
    const rows = await this.reports.find({
      where: { userId },
      order: { host: 'ASC' },
    });

    return rows.map((row) => ({
      host: row.host,
      reportedAt: row.reportedAt.toISOString(),
      data: row.data,
      ...assessNas(row.data, row.reportedAt, now),
    }));
  }
}
