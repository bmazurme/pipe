import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ClaimedProviderDto } from './dto/provider-credential-response.dto';
import {
  PROVIDER_MODELS,
  ProviderCredential,
  type ProviderModel,
} from './entities/provider-credential.entity';

export function isProviderModel(value: string): value is ProviderModel {
  return (PROVIDER_MODELS as readonly string[]).includes(value);
}

@Injectable()
export class ProviderCredentialsService {
  constructor(
    @InjectRepository(ProviderCredential)
    private readonly repository: Repository<ProviderCredential>,
  ) {}

  async create(
    userId: number,
    input: {
      provider: ProviderModel;
      name: string;
      apiKey: string;
      baseUrl?: string;
      model?: string;
    },
  ): Promise<ProviderCredential> {
    return this.repository.save(
      this.repository.create({
        userId,
        provider: input.provider,
        name: input.name.trim(),
        apiKey: input.apiKey.trim(),
        baseUrl: input.baseUrl?.trim() || null,
        model: input.model?.trim() || null,
      }),
    );
  }

  // Oldest first: the first one added is a provider's default.
  async findAllByUser(userId: number): Promise<ProviderCredential[]> {
    return this.repository.find({ where: { userId }, order: { id: 'ASC' } });
  }

  async remove(id: number, userId: number): Promise<void> {
    const result = await this.repository.delete({ id, userId });

    if (!result.affected) {
      throw new NotFoundException('Provider credential not found');
    }
  }

  // Does this account have the credential, and is it for this provider? Used when a job names one at launch.
  async existsFor(
    id: number,
    userId: number,
    provider: ProviderModel,
  ): Promise<boolean> {
    return this.repository.existsBy({ id, userId, provider });
  }

  // How many keys the account has for each provider — the launch form warns when the chosen model has none.
  async countsByProvider(
    userId: number,
  ): Promise<Record<ProviderModel, number>> {
    const rows = await this.repository.find({
      where: { userId },
      select: { provider: true },
    });
    const counts: Record<ProviderModel, number> = {
      gpt: 0,
      deepseek: 0,
      qwen: 0,
    };

    for (const row of rows) counts[row.provider] += 1;

    return counts;
  }

  // The one place the raw key leaves this service: the credential the job named, else the account's first one for the
  // provider. Null when there is none (the worker then falls back to its own environment, as before).
  async resolveForJob(
    userId: number,
    model: string,
    credentialId: number | null,
  ): Promise<ClaimedProviderDto | null> {
    if (!isProviderModel(model)) {
      return null;
    }

    const credential =
      credentialId !== null
        ? await this.repository.findOneBy({
            id: credentialId,
            userId,
            provider: model,
          })
        : null;
    const chosen =
      credential ??
      (await this.repository.findOne({
        where: { userId, provider: model },
        order: { id: 'ASC' },
      }));

    return chosen
      ? { apiKey: chosen.apiKey, baseUrl: chosen.baseUrl, model: chosen.model }
      : null;
  }
}
