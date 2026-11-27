import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { DeploymentAccessService } from '../auth/deployment-access';
import { OwnerGuard } from '../auth/guards/owner.guard';
import { UsersService } from '../users/users.service';
import { ContextService } from '../context/context.service';

import { DEFAULT_CATEGORIES } from './analysis';
import { StartAnalysisDto } from './dto/improve.dto';
import { ImproveIssueFilingService } from './improve-issue-filing.service';
import { ImproveQualityService } from './improve-quality.service';
import { ImproveController } from './improve.controller';
import { ImproveAutoStartService } from './improve-auto-start.service';
import { ImproveScheduleService } from './improve-schedule.service';
import { ImproveService } from './improve.service';

const LIMITS = { minValue: 3, maxOpenPerCategory: 3, dailyIssueCap: 5 };

describe('ImproveController', () => {
  const user = { id: 7 };
  let service: {
    startAnalysis: jest.Mock;
    startRun: jest.Mock;
    startMany: jest.Mock;
    startItems: jest.Mock;
  };
  let autoStart: {
    getSettings: jest.Mock;
    saveSettings: jest.Mock;
    getFilingLimits: jest.Mock;
    saveFilingLimits: jest.Mock;
  };
  let controller: ImproveController;
  let contexts: { findOwned: jest.Mock };
  let quality: { summary: jest.Mock; sync: jest.Mock };

  beforeEach(() => {
    contexts = { findOwned: jest.fn().mockResolvedValue({ id: 5 }) };
    service = {
      startAnalysis: jest.fn().mockResolvedValue({ id: 1 }),
      startRun: jest.fn().mockResolvedValue({ id: 2 }),
      startMany: jest.fn().mockResolvedValue({ started: [], skipped: [] }),
      startItems: jest.fn().mockResolvedValue({ id: 3 }),
    };
    quality = {
      summary: jest.fn().mockResolvedValue({ days: 90 }),
      sync: jest.fn().mockResolvedValue({ checked: 1, remaining: 0 }),
    };
    autoStart = {
      getSettings: jest.fn().mockResolvedValue(null),
      saveSettings: jest.fn().mockResolvedValue({
        autoStartModel: null,
        autoRepairCi: true,
      }),
      getFilingLimits: jest.fn().mockResolvedValue(LIMITS),
      saveFilingLimits: jest.fn().mockResolvedValue(LIMITS),
    };
    // schedules live in their own service now (#287); none of the flows under test here touches them
    controller = new ImproveController(
      service as unknown as ImproveService,
      {} as unknown as ImproveScheduleService,
      autoStart as unknown as ImproveAutoStartService,
      {} as unknown as ImproveIssueFilingService,
      contexts as unknown as ContextService,
      quality as unknown as ImproveQualityService,
    );
  });

  describe('quality', () => {
    it('asks for 90 days by default and never for more than a year or less than a day', async () => {
      await controller.qualityView(90, user);
      await controller.qualityView(5000, user);
      await controller.qualityView(0, user);

      expect(quality.summary.mock.calls.map((call) => call[1])).toEqual([
        90, 365, 1,
      ]);
    });

    it('refreshes on request', async () => {
      await expect(controller.refreshQuality(user)).resolves.toEqual({
        checked: 1,
        remaining: 0,
      });
    });
  });

  describe('startAnalysis', () => {
    const start = (dto: Partial<StartAnalysisDto>) =>
      controller.startAnalysis(
        { model: 'sonnet', ...dto } as StartAnalysisDto,
        user,
      );

    it('uses the improvement directions (not new features) when none are given', async () => {
      await start({});

      expect(service.startAnalysis.mock.calls[0][2]).toEqual(
        DEFAULT_CATEGORIES,
      );
      expect(service.startAnalysis.mock.calls[0][2]).not.toContain('features');
    });

    it('uses them when the list is empty', async () => {
      await start({ categories: [] });

      expect(service.startAnalysis.mock.calls[0][2]).toEqual(
        DEFAULT_CATEGORIES,
      );
    });

    it('passes the new-features direction through when it is ticked', async () => {
      await start({ categories: ['general', 'features'] });

      expect(service.startAnalysis.mock.calls[0][2]).toEqual([
        'general',
        'features',
      ]);
    });

    it('rejects an unknown category without calling the service', () => {
      expect(() =>
        start({ categories: ['no-such-category'] as never }),
      ).toThrow(BadRequestException);
      expect(service.startAnalysis).not.toHaveBeenCalled();
    });

    it.each([
      [{ autoStart: true }, true, true],
      [{ autoCreate: true }, true, false],
      [{}, false, false],
    ])('maps %j to create=%s, start=%s', async (flags, create, run) => {
      await start(flags);

      const args = service.startAnalysis.mock.calls[0];

      expect(args[3]).toBe(create);
      expect(args[6]).toBe(run);
    });
  });

  describe('a Context for a manual start', () => {
    it("hands the caller's own context to a single run, a batch, an analysis and the items of an analysis", async () => {
      await controller.startRun(
        { issueNumber: 4, model: 'sonnet', contextId: 5 } as never,
        user,
      );
      await controller.startMany(
        { issueNumbers: [4, 5], model: 'sonnet', contextId: 5 } as never,
        user,
      );
      await controller.startAnalysis(
        { model: 'sonnet', contextId: 5 } as StartAnalysisDto,
        user,
      );
      await controller.startItems(
        9,
        { model: 'sonnet', indices: [0], contextId: 5 } as never,
        user,
      );

      expect(contexts.findOwned).toHaveBeenCalledTimes(4);
      expect(contexts.findOwned).toHaveBeenCalledWith(5, 7);
      expect(service.startRun).toHaveBeenCalledWith(
        7,
        4,
        'sonnet',
        'manual',
        null,
        5,
      );
      expect(service.startMany).toHaveBeenCalledWith(7, [4, 5], 'sonnet', 5);
      expect(service.startAnalysis.mock.calls[0][7]).toBe(5);
      expect(service.startItems).toHaveBeenCalledWith(9, 'sonnet', [0], 5);
    });

    it('starts without a context when none is named, and does not look one up', async () => {
      await controller.startRun(
        { issueNumber: 4, model: 'sonnet' } as never,
        user,
      );

      expect(contexts.findOwned).not.toHaveBeenCalled();
      expect(service.startRun.mock.calls[0][5]).toBeNull();
    });

    it("refuses a context that is not the caller's before anything is started", async () => {
      contexts.findOwned.mockRejectedValue(new NotFoundException());

      await expect(
        controller.startRun(
          { issueNumber: 4, model: 'sonnet', contextId: 99 } as never,
          user,
        ),
      ).rejects.toThrow(NotFoundException);
      await expect(
        controller.startAnalysis(
          { model: 'sonnet', contextId: 99 } as StartAnalysisDto,
          user,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(service.startRun).not.toHaveBeenCalled();
      expect(service.startAnalysis).not.toHaveBeenCalled();
    });
  });

  describe('settings', () => {
    it('defaults when nothing is stored', async () => {
      await expect(controller.settings(user)).resolves.toEqual({
        autoStartModel: null,
        autoRepairCi: true,
        autoRedoConflicts: false,
        ...LIMITS,
      });
    });
  });

  describe('saveSettings', () => {
    it('keeps the stored model when only autoRepairCi is sent', async () => {
      autoStart.getSettings.mockResolvedValue({
        autoStartModel: 'opus',
        autoRepairCi: true,
      });

      await controller.saveSettings({ autoRepairCi: false }, user);

      expect(autoStart.saveSettings).toHaveBeenCalledWith(
        7,
        'opus',
        false,
        undefined,
      );
    });

    it('passes the filing limits on, only the ones sent', async () => {
      autoStart.saveFilingLimits.mockResolvedValue({
        ...LIMITS,
        dailyIssueCap: 2,
      });

      await expect(
        controller.saveSettings({ dailyIssueCap: 2 }, user),
      ).resolves.toEqual(expect.objectContaining({ dailyIssueCap: 2 }));
      expect(autoStart.saveFilingLimits).toHaveBeenCalledWith(7, {
        minValue: undefined,
        maxOpenPerCategory: undefined,
        dailyIssueCap: 2,
      });
    });

    it('switches the model off with an empty string', async () => {
      await controller.saveSettings({ autoStartModel: '' }, user);

      expect(autoStart.saveSettings).toHaveBeenCalledWith(
        7,
        null,
        undefined,
        undefined,
      );
    });
  });
});

describe('ImproveController access', () => {
  it('is guarded by JwtGuard and OwnerGuard', () => {
    const guards = Reflect.getMetadata('__guards__', ImproveController);

    expect(guards).toEqual([JwtGuard, OwnerGuard]);
  });

  it('answers 403 to a non-owner on POST /improve/runs', async () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      ImproveController,
    ) as unknown[];

    expect(guards).toContain(OwnerGuard);

    const guard = new OwnerGuard(
      new DeploymentAccessService(
        {
          findOwner: jest.fn().mockResolvedValue({ id: 1 }),
          findById: jest.fn().mockResolvedValue({ id: 2, email: 'x@y.z' }),
        } as unknown as UsersService,
        { get: jest.fn().mockReturnValue('') } as unknown as ConfigService,
      ),
    );
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 2 } }) }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
