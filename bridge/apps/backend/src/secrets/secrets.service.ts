import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateSecretDto } from './dto/create-secret.dto';
import { UpdateSecretDto } from './dto/update-secret.dto';
import { Secret } from './entities/secret.entity';

@Injectable()
export class SecretsService {
  constructor(
    @InjectRepository(Secret)
    private readonly repository: Repository<Secret>,
  ) {}

  async findAllByUser(userId: number): Promise<Secret[]> {
    return this.repository.find({ where: { userId }, order: { name: 'ASC' } });
  }

  async create(userId: number, dto: CreateSecretDto): Promise<Secret> {
    const existing = await this.repository.findOne({
      where: { userId, name: dto.name },
    });

    if (existing) {
      throw new BadRequestException(
        `A secret named "${dto.name}" already exists`,
      );
    }

    return this.repository.save(
      this.repository.create({
        userId,
        name: dto.name,
        value: dto.value,
        description: dto.description ?? null,
      }),
    );
  }

  async update(
    id: number,
    userId: number,
    dto: UpdateSecretDto,
  ): Promise<Secret> {
    const secret = await this.repository.findOne({ where: { id, userId } });

    if (!secret) {
      throw new NotFoundException('Secret not found');
    }

    if (dto.name !== undefined && dto.name !== secret.name) {
      const existing = await this.repository.findOne({
        where: { userId, name: dto.name },
      });

      if (existing) {
        throw new BadRequestException(
          `A secret named "${dto.name}" already exists`,
        );
      }
    }

    if (dto.name !== undefined) secret.name = dto.name;
    if (dto.value !== undefined) secret.value = dto.value;
    if (dto.description !== undefined) secret.description = dto.description;

    return this.repository.save(secret);
  }

  async delete(id: number, userId: number): Promise<void> {
    const secret = await this.repository.findOne({ where: { id, userId } });

    if (!secret) {
      throw new NotFoundException('Secret not found');
    }

    await this.repository.delete(secret.id);
  }

  // The one place a stored value leaves this service — scoped to the
  // owning user, same as ClaudeCredentialsService.resolveToken, but called
  // from the user's own "reveal" action here rather than by another
  // product handing it off to a machine.
  async revealValue(id: number, userId: number): Promise<string> {
    const secret = await this.repository.findOne({ where: { id, userId } });

    if (!secret) {
      throw new NotFoundException('Secret not found');
    }

    return secret.value;
  }
}
