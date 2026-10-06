import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TelegramService } from '../telegram/telegram.service';
import { ClientHeartbeatService } from './client-heartbeat.service';
import { LoopEvent } from './entities/loop-event.entity';
import {
  LoopRun,
  LoopStage,
  TERMINAL_LOOP_STAGES,
} from './entities/loop-run.entity';
import { interpretGithubEvent } from './github-events';
import { MergeService } from './merge.service';

const STATUS_RUN_COUNT = 5;

@Injectable()
export class LoopService {
  private readonly logger = new Logger(LoopService.name);

  constructor(
    @InjectRepository(LoopRun)
    private readonly runs: Repository<LoopRun>,
    @InjectRepository(LoopEvent)
    private readonly events: Repository<LoopEvent>,
    private readonly telegram: TelegramService,
    private readonly configService: ConfigService,
    private readonly clients: ClientHeartbeatService,
    private readonly merges: MergeService,
  ) {}

  startRun(title: string): Promise<LoopRun> {
    return this.runs.save(
      this.runs.create({ title, stage: LoopStage.Analyzing }),
    );
  }

  // Returns false when the delivery meant nothing to the loop (an event type
  // or PR the loop doesn't track) — the controller still answers 2xx so
  // GitHub doesn't mark the delivery failed and retry it.
  async handleGithubEvent(event: string, payload: unknown): Promise<boolean> {
    const interpretation = interpretGithubEvent(event, payload, {
      ci: this.configService.get<string>('GITHUB_CI_WORKFLOW') ?? 'CI',
      deploy:
        this.configService.get<string>('GITHUB_DEPLOY_WORKFLOW') ??
        'Deploy bridge',
    });

    if (!interpretation) {
      return false;
    }

    let run = await this.findRun(interpretation);

    // A loop PR no run knows about (reports opens PRs from its own branch
    // names) becomes a run, so it shows in /status and its CI/merge/deploy
    // events have somewhere to land.
    if (!run && interpretation.adopt && interpretation.prNumber) {
      run = await this.runs.save(
        this.runs.create({
          title: interpretation.adopt.title.slice(0, 255),
          stage: LoopStage.PrOpen,
          prNumber: interpretation.prNumber,
          branch: interpretation.branch ?? null,
        }),
      );
    }

    if (run) {
      // A finished run never regresses (a late CI webhook for an already
      // merged-and-deployed run must not drag it back to `ci`).
      if (interpretation.stage && !TERMINAL_LOOP_STAGES.includes(run.stage)) {
        run.stage = interpretation.stage;
      }

      if (interpretation.error !== undefined) {
        run.error = interpretation.error;
      }

      run.prNumber = interpretation.prNumber ?? run.prNumber;
      run.branch = interpretation.branch ?? run.branch;
      await this.runs.save(run);
    }

    await this.events.save(
      this.events.create({
        runId: run?.id ?? null,
        source: 'github',
        type: interpretation.type,
        summary: interpretation.message.slice(0, 500),
      }),
    );

    // Green CI on a tracked PR: not a plain notice but the merge offer, which
    // re-checks the PR itself (see MergeService).
    if (run && interpretation.offerMerge && run.prNumber) {
      await this.merges.offer(run.prNumber);
    } else if (run || interpretation.notifyUnmatched) {
      const prefix = run ? `[run #${run.id}] ` : '';

      await this.telegram.send(`${prefix}${interpretation.message}`);
    }

    return true;
  }

  async statusText(): Promise<string> {
    const [runs, clientLines] = await Promise.all([
      this.runs.find({ order: { id: 'DESC' }, take: STATUS_RUN_COUNT }),
      this.clients.statusLines(),
    ]);

    const runLines =
      runs.length === 0
        ? ['Циклов пока не было.']
        : runs.map((run) => {
            const pr = run.prNumber ? ` · PR #${run.prNumber}` : '';
            const error = run.error ? ` · ⚠ ${run.error}` : '';

            return `#${run.id} [${run.stage}] ${run.title}${pr}${error}`;
          });

    return [
      ...runLines,
      ...(clientLines.length ? ['', ...clientLines] : []),
    ].join('\n');
  }

  private async findRun(interpretation: {
    runId?: number;
    prNumber?: number;
    matchDeploying?: boolean;
  }): Promise<LoopRun | null> {
    if (interpretation.runId !== undefined) {
      const byId = await this.runs.findOne({
        where: { id: interpretation.runId },
      });

      if (byId) {
        return byId;
      }
    }

    if (interpretation.prNumber !== undefined) {
      const byPr = await this.runs.findOne({
        where: { prNumber: interpretation.prNumber },
        order: { id: 'DESC' },
      });

      if (byPr) {
        return byPr;
      }
    }

    if (interpretation.matchDeploying) {
      return this.runs.findOne({
        where: { stage: LoopStage.Deploying },
        order: { id: 'DESC' },
      });
    }

    return null;
  }
}
