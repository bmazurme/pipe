import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateContextDto } from './dto/create-context.dto';
import { UpdateContextDto } from './dto/update-context.dto';
import { Context } from './entities/context.entity';

@Injectable()
export class ContextService {
  constructor(
    @InjectRepository(Context)
    private readonly repository: Repository<Context>,
  ) {}

  findAllByUser(userId: number): Promise<Context[]> {
    return this.repository.find({ where: { userId }, order: { name: 'ASC' } });
  }

  // For attaching to a job: scoped to the owner, so one user can never pull
  // another's context into their own run by guessing an id.
  async findOwned(id: number, userId: number): Promise<Context> {
    const context = await this.repository.findOne({ where: { id, userId } });

    if (!context) {
      throw new NotFoundException('Context not found');
    }

    return context;
  }

  async create(userId: number, dto: CreateContextDto): Promise<Context> {
    await this.assertNameFree(userId, dto.name);

    return this.saveOrThrowConflict(
      this.repository.create({
        userId,
        name: dto.name.trim(),
        content: dto.content,
      }),
    );
  }

  async update(
    id: number,
    userId: number,
    dto: UpdateContextDto,
  ): Promise<Context> {
    const context = await this.findOwned(id, userId);

    if (dto.name !== undefined && dto.name.trim() !== context.name) {
      await this.assertNameFree(userId, dto.name);
      context.name = dto.name.trim();
    }

    if (dto.content !== undefined) context.content = dto.content;

    return this.saveOrThrowConflict(context);
  }

  // Jobs hold their own snapshot of the text they started with, so deleting a
  // context never changes a job that is queued or already ran with it.
  async delete(id: number, userId: number): Promise<void> {
    const context = await this.findOwned(id, userId);

    await this.repository.delete(context.id);
  }

  private async assertNameFree(userId: number, name: string): Promise<void> {
    const existing = await this.repository.findOne({
      where: { userId, name: name.trim() },
    });

    if (existing) {
      throw this.nameTakenError(name);
    }
  }

  // assertNameFree is only a fast path: two concurrent saves can both pass it,
  // and the (userId, name) unique index then rejects the second one.
  private async saveOrThrowConflict(context: Context): Promise<Context> {
    try {
      return await this.repository.save(context);
    } catch (error) {
      const code = (error as { driverError?: { code?: string } })?.driverError
        ?.code;

      if (code === '23505') {
        throw this.nameTakenError(context.name);
      }

      throw error;
    }
  }

  private nameTakenError(name: string): BadRequestException {
    return new BadRequestException(
      `A context named "${name.trim()}" already exists`,
    );
  }
}
