import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ReportsSettingsBackup } from './entities/reports-settings-backup.entity';

@Injectable()
export class ReportsSettingsService {
  constructor(
    @InjectRepository(ReportsSettingsBackup)
    private readonly repository: Repository<ReportsSettingsBackup>,
  ) {}

  async findForUser(userId: number): Promise<ReportsSettingsBackup | null> {
    return this.repository.findOneBy({ userId });
  }

  // Status check: no `payload`, so the encrypted bundle is not decrypted.
  async findStatusForUser(
    userId: number,
  ): Promise<ReportsSettingsBackup | null> {
    return this.repository.findOne({
      where: { userId },
      select: ['id', 'userId', 'updatedAt'],
    });
  }

  async getForUser(userId: number): Promise<ReportsSettingsBackup> {
    const backup = await this.findForUser(userId);

    if (!backup)
      throw new NotFoundException('Бэкап настроек reports ещё не сохранён');

    return backup;
  }

  async upsertForUser(
    userId: number,
    payload: string,
  ): Promise<ReportsSettingsBackup> {
    const existing = await this.findForUser(userId);

    if (existing) {
      existing.payload = payload;

      return this.repository.save(existing);
    }

    return this.repository.save(this.repository.create({ userId, payload }));
  }

  async deleteForUser(userId: number): Promise<void> {
    await this.repository.delete({ userId });
  }
}
