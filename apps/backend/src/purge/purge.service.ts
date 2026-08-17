import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreatePurgeEntryDto } from './dto/create-purge-entry.dto';
import { UpdatePurgeEntryDto } from './dto/update-purge-entry.dto';
import { PurgeEntry } from './entities/purge-entry.entity';

@Injectable()
export class PurgeService {
  constructor(
    @InjectRepository(PurgeEntry)
    private readonly purgeEntryRepository: Repository<PurgeEntry>,
  ) {}

  async findAllByUser(userId: number): Promise<PurgeEntry[]> {
    return this.purgeEntryRepository.find({
      where: { userId },
      order: { key: 'ASC' },
    });
  }

  async create(userId: number, dto: CreatePurgeEntryDto): Promise<PurgeEntry> {
    const [existingKey, existingValue] = await Promise.all([
      this.purgeEntryRepository.findOne({
        where: { userId, key: dto.key },
      }),
      this.purgeEntryRepository.findOne({
        where: { userId, value: dto.value },
      }),
    ]);

    if (existingKey) {
      throw new BadRequestException(`Key "${dto.key}" already exists`);
    }

    if (existingValue) {
      throw new BadRequestException(`Value "${dto.value}" already exists`);
    }

    return this.purgeEntryRepository.save({ userId, ...dto });
  }

  async update(
    id: number,
    userId: number,
    dto: UpdatePurgeEntryDto,
  ): Promise<PurgeEntry> {
    const entry = await this.purgeEntryRepository.findOne({
      where: { id, userId },
    });

    if (!entry) {
      throw new NotFoundException('Dictionary entry not found');
    }

    if (dto.key !== undefined && dto.key !== entry.key) {
      const existingKey = await this.purgeEntryRepository.findOne({
        where: { userId, key: dto.key },
      });

      if (existingKey) {
        throw new BadRequestException(`Key "${dto.key}" already exists`);
      }
    }

    if (dto.value !== undefined && dto.value !== entry.value) {
      const existingValue = await this.purgeEntryRepository.findOne({
        where: { userId, value: dto.value },
      });

      if (existingValue) {
        throw new BadRequestException(`Value "${dto.value}" already exists`);
      }
    }

    Object.assign(entry, dto);

    return this.purgeEntryRepository.save(entry);
  }

  async delete(id: number, userId: number): Promise<void> {
    const entry = await this.purgeEntryRepository.findOne({
      where: { id, userId },
    });

    if (!entry) {
      throw new NotFoundException('Dictionary entry not found');
    }

    await this.purgeEntryRepository.delete(entry.id);
  }
}
