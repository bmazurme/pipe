import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UpsReportDto } from './dto/ups.dto';
import { UpsReport } from './entities/ups-report.entity';
import { assessUps, UpsAssessment, UpsData } from './ups';

export interface UpsView extends UpsAssessment {
  host: string;
  reportedAt: string;
  data: UpsData;
}

@Injectable()
export class UpsService {
  constructor(
    @InjectRepository(UpsReport)
    private readonly reports: Repository<UpsReport>,
  ) {}

  // The UPS's own account of itself. Only the latest is kept: the Dashboard shows now, not history.
  async record(userId: number, dto: UpsReportDto): Promise<void> {
    await this.reports.upsert(
      {
        userId,
        host: dto.host,
        reportedAt: new Date(),
        data: dto as unknown as UpsData,
      },
      ['userId', 'host'],
    );
  }

  async list(userId: number, now = new Date()): Promise<UpsView[]> {
    const rows = await this.reports.find({
      where: { userId },
      order: { host: 'ASC' },
    });

    return rows.map((row) => ({
      host: row.host,
      reportedAt: row.reportedAt.toISOString(),
      data: row.data,
      ...assessUps(row.data, row.reportedAt, now),
    }));
  }
}
