import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ImproveSchedule } from '../improve/entities/improve-schedule.entity';
import { Job } from '../worker/entities/job.entity';

import { CreateContextDto } from './dto/create-context.dto';
import { UpdateContextDto } from './dto/update-context.dto';
import { Context } from './entities/context.entity';

export interface ContextUsage {
  schedules: { id: number; name: string }[];
  lastUsedAt: Date | null;
}

export type ContextWithUsage = Context & ContextUsage;

@Injectable()
export class ContextService {
  constructor(
    @InjectRepository(Context)
    private readonly repository: Repository<Context>,
    @InjectRepository(ImproveSchedule)
    private readonly schedules: Repository<ImproveSchedule>,
    @InjectRepository(Job)
    private readonly jobs: Repository<Job>,
  ) {}

  // Summaries: `content` is deliberately not selected, so nothing is decrypted or copied
  // for a list — each context's full text is up to 20 000 characters. The text comes from
  // findOwned, when one context is actually opened.
  async findAllByUser(userId: number): Promise<ContextWithUsage[]> {
    const contexts = await this.repository.find({
      select: [
        'id',
        'userId',
        'name',
        'contentLength',
        'createdAt',
        'updatedAt',
      ],
      where: { userId },
      order: { name: 'ASC' },
    });

    if (contexts.length === 0) {
      return [];
    }

    const schedules = await this.schedules.find({
      select: ['id', 'name', 'contextId'],
      where: { userId, contextId: In(contexts.map((c) => c.id)) },
      order: { name: 'ASC' },
    });

    // Jobs keep only the context's name, not its id, so the match is by the
    // current name: a renamed context loses its history, and a deleted one
    // re-created under the same name inherits it.
    const lastUsed = await this.jobs
      .createQueryBuilder('job')
      .select('job.contextName', 'contextName')
      .addSelect('MAX(job.createdAt)', 'lastUsedAt')
      .where('job.userId = :userId', { userId })
      .andWhere('job.contextName IS NOT NULL')
      .groupBy('job.contextName')
      .getRawMany<{ contextName: string; lastUsedAt: Date | string }>();
    const lastUsedByName = new Map(
      lastUsed.map((row) => [row.contextName, new Date(row.lastUsedAt)]),
    );

    return contexts.map((context) =>
      Object.assign(context, {
        schedules: schedules
          .filter((schedule) => schedule.contextId === context.id)
          .map((schedule) => ({ id: schedule.id, name: schedule.name })),
        lastUsedAt: lastUsedByName.get(context.name) ?? null,
      }),
    );
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
        contentLength: dto.content.length,
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

    if (dto.content !== undefined) {
      context.content = dto.content;
      context.contentLength = dto.content.length;
    }

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
