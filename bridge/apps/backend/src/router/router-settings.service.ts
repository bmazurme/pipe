import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { requireImproveModel } from '../improve/improve-shared';
import { ProviderCredentialsService } from '../worker/provider-credentials.service';
import { RouterSettingsRow } from './entities/router-settings.entity';
import {
  DEFAULT_SETTINGS,
  type RouterSettings,
  TIERS,
  validateSettings,
} from './router-policy';

@Injectable()
export class RouterSettingsService {
  constructor(
    @InjectRepository(RouterSettingsRow)
    private readonly rows: Repository<RouterSettingsRow>,
    private readonly keys: ProviderCredentialsService,
  ) {}

  async get(userId: number): Promise<RouterSettings> {
    const row = await this.rows.findOneBy({ userId });

    return row
      ? {
          tierModels: { ...DEFAULT_SETTINGS.tierModels, ...row.tierModels },
          rules: row.rules,
        }
      : DEFAULT_SETTINGS;
  }

  // A model is known when Improve/Lab knows it; a custom one must also be a key of the owner's.
  private async knownModels(
    userId: number,
    settings: RouterSettings,
  ): Promise<(model: string) => boolean> {
    const customIds = new Set<number>();
    const wanted = [
      ...TIERS.map((tier) => settings.tierModels[tier]),
      ...settings.rules.map((rule) => rule.model),
    ];

    for (const model of wanted) {
      const match = /^custom:(\d+)$/.exec(model ?? '');

      if (
        match &&
        (await this.keys.existsFor(Number(match[1]), userId, 'custom'))
      )
        customIds.add(Number(match[1]));
    }

    return (model) => {
      try {
        requireImproveModel(model);
      } catch {
        return false;
      }

      const match = /^custom:(\d+)$/.exec(model);

      return !match || customIds.has(Number(match[1]));
    };
  }

  async save(
    userId: number,
    settings: RouterSettings,
  ): Promise<RouterSettings> {
    const clean: RouterSettings = {
      tierModels: settings.tierModels,
      rules: settings.rules.map((rule) => ({
        name: rule.name.trim(),
        keywords: rule.keywords,
        model: rule.model,
        enabled: rule.enabled !== false,
      })),
    };
    const problem = validateSettings(
      clean,
      await this.knownModels(userId, clean),
    );

    if (problem) throw new BadRequestException(problem);

    const existing = await this.rows.findOneBy({ userId });

    await this.rows.save({
      ...(existing ?? {}),
      userId,
      tierModels: clean.tierModels,
      rules: clean.rules,
    });

    return clean;
  }
}
