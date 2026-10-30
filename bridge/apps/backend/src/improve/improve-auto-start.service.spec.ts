import { ImproveAutoStartService } from './improve-auto-start.service';

function setup() {
  const settings = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (s: object) => s),
  };
  const workers = {
    create: jest.fn().mockResolvedValue({ id: 321 }),
    findUnstartedIssueParcels: jest.fn().mockResolvedValue([]),
  };
  const appLogs = { record: jest.fn() };
  const service = new ImproveAutoStartService(
    settings as never,
    workers as never,
    appLogs as never,
  );

  return { service, settings, workers, appLogs };
}

describe('auto-start of pushed parcels', () => {
  it("starts a job for each parcel the query returns, with the account's model", async () => {
    const { service, settings, workers } = setup();
    const since = new Date('2026-10-01T00:00:00Z');
    settings.find.mockResolvedValue([
      { userId: 3, autoStartModel: 'opus', autoStartSince: since },
    ]);
    workers.findUnstartedIssueParcels.mockResolvedValue([{ id: 40 }]);
    workers.create.mockResolvedValue({ id: 77 });

    await service.autoStartParcels();

    expect(workers.create).toHaveBeenCalledTimes(1);
    expect(workers.create).toHaveBeenCalledWith(3, {
      sourceFileId: 40,
      model: 'opus',
    });
    // Worker owns which parcels are eligible; Improve only asks, excluding its own.
    expect(workers.findUnstartedIssueParcels).toHaveBeenCalledWith(
      3,
      since,
      expect.any(Number),
      'improve:',
    );
  });

  it('keeps going when one parcel cannot be started', async () => {
    const { service, settings, workers } = setup();
    settings.find.mockResolvedValue([
      { userId: 3, autoStartModel: 'gpt', autoStartSince: new Date() },
    ]);
    workers.findUnstartedIssueParcels.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    workers.create
      .mockRejectedValueOnce(new Error('File not found'))
      .mockResolvedValueOnce({ id: 9 });

    await service.autoStartParcels();

    expect(workers.create).toHaveBeenCalledTimes(2);
  });

  it('remembers when auto-start was switched on, so old parcels are never swept up', async () => {
    const { service, settings } = setup();

    await service.saveSettings(3, 'sonnet');
    expect(settings.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 3,
        autoStartModel: 'sonnet',
        autoStartSince: expect.any(Date),
      }),
    );

    await service.saveSettings(3, null);
    expect(settings.save).toHaveBeenLastCalledWith({
      userId: 3,
      autoStartModel: null,
      autoStartSince: null,
      autoRepairCi: true,
      autoRedoConflicts: false,
    });
    await expect(service.saveSettings(3, 'nope')).rejects.toThrow(
      /Неизвестная модель/,
    );
  });
});

describe('ImproveAutoStartService.saveSettings', () => {
  it('keeps the CI-repair switch when only the auto-start model is saved, and the other way round', async () => {
    const { service, settings } = setup();
    settings.findOne.mockResolvedValue({
      userId: 3,
      autoStartModel: 'sonnet',
      autoRepairCi: false,
    });

    await service.saveSettings(3, 'opus');
    expect(settings.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ autoStartModel: 'opus', autoRepairCi: false }),
    );

    await service.saveSettings(3, 'sonnet', true);
    expect(settings.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ autoRepairCi: true }),
    );
  });

  it('defaults to repairing CI when nothing is stored yet', async () => {
    const { service, settings } = setup();

    await service.saveSettings(3, null);

    expect(settings.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ autoRepairCi: true }),
    );
  });
});

describe('ImproveAutoStartService conflict redo switch', () => {
  it('is off for an account that never saved settings, and saving other settings does not switch it on or off', async () => {
    const { service, settings } = setup();

    await service.saveSettings(3, null, true, true);
    expect(settings.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ autoRedoConflicts: true }),
    );

    settings.findOne.mockResolvedValue({
      userId: 3,
      autoStartModel: null,
      autoStartSince: null,
      autoRepairCi: true,
      autoRedoConflicts: true,
    });
    await service.saveSettings(3, null, false);
    expect(settings.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ autoRepairCi: false, autoRedoConflicts: true }),
    );
  });
});
