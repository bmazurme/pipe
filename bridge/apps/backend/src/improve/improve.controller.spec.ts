import { BadRequestException } from '@nestjs/common';

import { ALL_CATEGORIES } from './analysis';
import { StartAnalysisDto } from './dto/improve.dto';
import { ImproveController } from './improve.controller';
import { ImproveService } from './improve.service';

describe('ImproveController', () => {
  const user = { id: 7 };
  let service: {
    startAnalysis: jest.Mock;
    getSettings: jest.Mock;
    saveSettings: jest.Mock;
  };
  let controller: ImproveController;

  beforeEach(() => {
    service = {
      startAnalysis: jest.fn().mockResolvedValue({ id: 1 }),
      getSettings: jest.fn().mockResolvedValue(null),
      saveSettings: jest.fn().mockResolvedValue({
        autoStartModel: null,
        autoRepairCi: true,
      }),
    };
    controller = new ImproveController(service as unknown as ImproveService);
  });

  describe('startAnalysis', () => {
    const start = (dto: Partial<StartAnalysisDto>) =>
      controller.startAnalysis(
        { model: 'sonnet', ...dto } as StartAnalysisDto,
        user,
      );

    it('uses every category when none are given', async () => {
      await start({});

      expect(service.startAnalysis.mock.calls[0][2]).toEqual(ALL_CATEGORIES);
    });

    it('uses every category when the list is empty', async () => {
      await start({ categories: [] });

      expect(service.startAnalysis.mock.calls[0][2]).toEqual(ALL_CATEGORIES);
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
      service.getSettings.mockResolvedValue({
        autoStartModel: 'opus',
        autoRepairCi: true,
      });

      await controller.saveSettings({ autoRepairCi: false }, user);

      expect(service.saveSettings).toHaveBeenCalledWith(7, 'opus', false);
    });

    it('switches the model off with an empty string', async () => {
      await controller.saveSettings({ autoStartModel: '' }, user);

      expect(service.saveSettings).toHaveBeenCalledWith(7, null, undefined);
    });
  });
});
