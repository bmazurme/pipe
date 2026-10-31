import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { CreateProviderCredentialDto } from './dto/create-provider-credential.dto';
import { ClaimedProviderDto } from './dto/provider-credential-response.dto';
import {
  PROVIDER_MODELS,
  ProviderCredential,
  type ProviderModel,
} from './entities/provider-credential.entity';

// Header names are case-insensitive and values are text; anything else is dropped rather than sent as "[object Object]".
function cleanHeaders(
  raw: Record<string, unknown> | undefined,
): Record<string, string> | null {
  const entries = Object.entries(raw ?? {})
    .filter(
      ([name, value]) =>
        /^[A-Za-z0-9-]{1,64}$/.test(name) &&
        typeof value === 'string' &&
        value.length <= 500,
    )
    .map(([name, value]) => [name, value as string] as const);

  return entries.length ? Object.fromEntries(entries) : null;
}

function numberOrNull(
  value: string | number | null | undefined,
): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toDecimal(value: number | undefined): string | null {
  return value === undefined ? null : String(value);
}

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
    input: CreateProviderCredentialDto,
  ): Promise<ProviderCredential> {
    const custom = input.provider === 'custom';
    const authScheme = custom ? (input.authScheme ?? 'bearer') : 'bearer';
    const apiKey = input.apiKey?.trim() ?? '';
    const baseUrl = input.baseUrl?.trim().replace(/\/+$/, '') || null;
    const model = input.model?.trim() || null;

    if (apiKey === '' && !(custom && authScheme === 'none')) {
      throw new BadRequestException('apiKey is required');
    }
    if (custom && (baseUrl === null || model === null)) {
      throw new BadRequestException(
        'A custom model needs an address (baseUrl) and a model name',
      );
    }

    return this.repository.save(
      this.repository.create({
        userId,
        provider: input.provider,
        name: input.name.trim(),
        apiKey,
        baseUrl,
        model,
        ...(custom
          ? {
              route: input.route ?? 'auto',
              authScheme,
              extraHeaders: cleanHeaders(input.extraHeaders),
              timeoutSec: input.timeoutSec ?? null,
              supportsTools: input.supportsTools ?? true,
              stream: input.stream ?? false,
              priceInPerMTok: toDecimal(input.priceInPerMTok),
              priceOutPerMTok: toDecimal(input.priceOutPerMTok),
              preset: input.preset?.trim() || null,
              allowedWorkerIds: input.allowedWorkerIds?.length
                ? input.allowedWorkerIds
                : null,
            }
          : {}),
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
      custom: 0,
    };

    for (const row of rows) counts[row.provider] += 1;

    return counts;
  }

  // The one place the raw key leaves this service: the credential the job named, else the account's first one for the
  // provider. Null when there is none (the worker then falls back to its own environment, as before). A custom key has no
  // "first": which server to talk to is the job's choice, so without one there is nothing to hand over.
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
      (model === 'custom'
        ? null
        : await this.repository.findOne({
            where: { userId, provider: model },
            order: { id: 'ASC' },
          }));

    if (!chosen) return null;

    return {
      apiKey: chosen.apiKey,
      baseUrl: chosen.baseUrl,
      model: chosen.model,
      ...(chosen.provider === 'custom'
        ? {
            route: chosen.route,
            authScheme: chosen.authScheme,
            ...(chosen.extraHeaders
              ? { extraHeaders: chosen.extraHeaders }
              : {}),
            timeoutSec: chosen.timeoutSec,
            supportsTools: chosen.supportsTools,
            stream: chosen.stream,
            priceInPerMTok: numberOrNull(chosen.priceInPerMTok),
            priceOutPerMTok: numberOrNull(chosen.priceOutPerMTok),
          }
        : {}),
    };
  }

  // What the claim and the launch checks need to know about the key a custom job names; null when it is not the owner's.
  async findForCheck(
    id: number,
    userId: number,
  ): Promise<Pick<
    ProviderCredential,
    'id' | 'provider' | 'allowedWorkerIds'
  > | null> {
    return this.repository.findOne({
      where: { id, userId },
      select: { id: true, provider: true, allowedWorkerIds: true },
    });
  }
}
