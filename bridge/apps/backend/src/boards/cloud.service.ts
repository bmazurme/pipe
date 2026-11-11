import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CloudReportDto } from './dto/cloud.dto';
import { CloudReport } from './entities/cloud-report.entity';
import { assessCloud, CloudAssessment, CloudData } from './cloud';

export interface CloudView extends CloudAssessment {
  host: string;
  reportedAt: string;
  data: CloudData;
}

@Injectable()
export class CloudService {
  constructor(
    @InjectRepository(CloudReport)
    private readonly reports: Repository<CloudReport>,
  ) {}

  // The VM's own account of itself. Only the latest is kept: the Dashboard shows now, not history.
  async record(userId: number, dto: CloudReportDto): Promise<void> {
    await this.reports.upsert(
      {
        userId,
        host: dto.host,
        reportedAt: new Date(),
        data: dto as unknown as CloudData,
      },
      ['userId', 'host'],
    );
  }

  async list(userId: number, now = new Date()): Promise<CloudView[]> {
    const rows = await this.reports.find({
      where: { userId },
      order: { host: 'ASC' },
    });

    return rows.map((row) => ({
      host: row.host,
      reportedAt: row.reportedAt.toISOString(),
      data: row.data,
      ...assessCloud(row.data, row.reportedAt, now),
    }));
  }
}
