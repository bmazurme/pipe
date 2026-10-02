import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ClaudeCredential } from './entities/claude-credential.entity';

@Injectable()
export class ClaudeCredentialsService {
  constructor(
    @InjectRepository(ClaudeCredential)
    private readonly repository: Repository<ClaudeCredential>,
  ) {}

  async create(
    userId: number,
    name: string,
    token: string,
  ): Promise<ClaudeCredential> {
    return this.repository.save(
      this.repository.create({ userId, name, token }),
    );
  }

  // Ascending id — the oldest (first added) credential is the frontend's
  // default pick, so this order is load-bearing, not cosmetic.
  async findAllByUser(userId: number): Promise<ClaudeCredential[]> {
    return this.repository.find({ where: { userId }, order: { id: 'ASC' } });
  }

  async remove(id: number, userId: number): Promise<void> {
    const result = await this.repository.delete({ id, userId });

    if (!result.affected) {
      throw new NotFoundException('Claude credential not found');
    }
  }

  // The one place the raw token value leaves this service — called only by
  // WorkerService.claim() to hand it to the worker process, scoped to the
  // owning user so one account can never pull another's credential by id.
  async resolveToken(id: number, userId: number): Promise<string | null> {
    const credential = await this.repository.findOne({
      where: { id, userId },
    });

    return credential?.token ?? null;
  }
}
