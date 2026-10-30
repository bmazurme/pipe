import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  DeployRecord,
  DeployResult,
} from '../loop/entities/deploy-record.entity';

export interface DeployView {
  sha: string;
  previousSha: string | null;
  result: DeployResult;
  detail: string | null;
  prNumbers: number[];
  at: string;
}

const LIMIT = 10;

// What the deploying board last said about each release (infra/autodeploy reports it to /api/v1/loop/deploys): the owner's "did my
// merge go out, and did it hold" without opening the board.
@Injectable()
export class DeploysService {
  constructor(
    @InjectRepository(DeployRecord)
    private readonly records: Repository<DeployRecord>,
  ) {}

  async latest(limit = LIMIT): Promise<DeployView[]> {
    const rows = await this.records.find({
      order: { id: 'DESC' },
      take: limit,
    });

    return rows.map((row) => ({
      sha: row.sha,
      previousSha: row.previousSha,
      result: row.result,
      detail: row.detail,
      prNumbers: row.prNumbers,
      at: row.createdAt.toISOString(),
    }));
  }
}
