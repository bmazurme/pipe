import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { DeploymentAccessService } from '../auth/deployment-access';
import { OwnerGuard } from '../auth/guards/owner.guard';
import { UsersService } from '../users/users.service';

import { DEFAULT_CATEGORIES } from './analysis';
import { StartAnalysisDto } from './dto/improve.dto';
import { ImproveController } from './improve.controller';
import { ImproveAutoStartService } from './improve-auto-start.service';
import { ImproveScheduleService } from './improve-schedule.service';
import { ImproveService } from './improve.service';

describe('ImproveController', () => {
  const user = { id: 7 };
  let service: {
    startAnalysis: jest.Mock;
  };
  let autoStart: {
    getSettings: jest.Mock;
    saveSettings: jest.Mock;
  };
  let controller: ImproveController;

  beforeEach(() => {
    service = {
      startAnalysis: jest.fn().mockResolvedValue({ id: 1 }),
    };
    autoStart = {
      getSettings: jest.fn().mockResolvedValue(null),
      saveSettings: jest.fn().mockResolvedValue({
        autoStartModel: null,
        autoRepairCi: true,
      }),
    };
    // schedules live in their own service now (#287); none of the flows under test here touches them
    controller = new ImproveController(
      service as unknown as ImproveService,
      {} as unknown as ImproveScheduleService,
      autoStart as unknown as ImproveAutoStartService,
    );
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

  describe('settings', () => {
    it('defaults when nothing is stored', async () => {
      await expect(controller.settings(user)).resolves.toEqual({
        autoStartModel: null,
        autoRepairCi: true,
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

      expect(autoStart.saveSettings).toHaveBeenCalledWith(7, 'opus', false);
    });

    it('switches the model off with an empty string', async () => {
      await controller.saveSettings({ autoStartModel: '' }, user);

      expect(autoStart.saveSettings).toHaveBeenCalledWith(7, null, undefined);
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
