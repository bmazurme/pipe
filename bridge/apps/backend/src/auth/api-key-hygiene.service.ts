import { Injectable, Logger, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { NotifyService } from '../telegram/notify.service';
import { keyHygiene } from './api-key-scope';
import { ApiKeysService } from './api-keys.service';

const EVERY_MS = 6 * 60 * 60_000;

// S5: the owner hears, once per key, that a key runs out within a week or that nobody has used it for a month. Without it a 90-day default would
// simply break sync one morning, and a forgotten key would sit there for years.
@Injectable()
export class ApiKeyHygieneService {
  private readonly logger = new Logger(ApiKeyHygieneService.name);
  private running = false;

  constructor(
    private readonly keys: ApiKeysService,
    @Optional() private readonly notifier?: NotifyService,
  ) {}

  @Interval(EVERY_MS)
  async sweep(now = new Date()): Promise<number> {
    if (this.running || !this.notifier) return 0;

    this.running = true;

    try {
      const findings = keyHygiene(await this.keys.findForHygiene(), now);

      for (const finding of findings) {
        // Marked first: a failing send is not retried every six hours for ever; the key page still shows the state.
        await this.keys.markNotified(finding.id, finding.kind);
        await this.notifier.send(finding.text);
      }

      return findings.length;
    } catch (error) {
      this.logger.warn(
        `API key hygiene sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      return 0;
    } finally {
      this.running = false;
    }
  }
}
