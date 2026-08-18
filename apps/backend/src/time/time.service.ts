import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import { DayOff } from './entities/day-off.entity';

@Injectable()
export class TimeService {
  constructor(
    @InjectRepository(DayOff)
    private readonly dayOffRepository: Repository<DayOff>,
  ) {}

  async findAllByUserAndYear(userId: number, year: number): Promise<DayOff[]> {
    return this.dayOffRepository.find({
      where: { userId, date: Between(`${year}-01-01`, `${year}-12-31`) },
      order: { date: 'ASC' },
    });
  }

  async create(userId: number, date: string): Promise<DayOff> {
    const existing = await this.dayOffRepository.findOne({
      where: { userId, date },
    });

    if (existing) {
      throw new BadRequestException(`Day off for ${date} already exists`);
    }

    return this.dayOffRepository.save({ userId, date });
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
}
