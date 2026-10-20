import { TimeExportController } from './time-export.controller';
import { TimeImportController } from './time-import.controller';

describe('time export/import controllers', () => {
  it('exports the days off of the account that owns the API key', async () => {
    const timeService = {
      findAllByUserAndYear: jest.fn().mockResolvedValue([]),
    };
    const controller = new TimeExportController(timeService as never);

    await controller.exportDayOffs(2026, { id: 42 });

    expect(timeService.findAllByUserAndYear).toHaveBeenCalledWith(42, 2026);
  });

  it('imports report entries into the account that owns the API key', async () => {
    const timeService = {
      importReportEntries: jest.fn().mockResolvedValue({ imported: 0 }),
    };
    const controller = new TimeImportController(timeService as never);

    await controller.importReports(
      { year: 2026, month: 3, entries: [] } as never,
      { id: 7 },
    );

    expect(timeService.importReportEntries).toHaveBeenCalledWith(
      7,
      2026,
      3,
      [],
    );
  });

  it('imports days off into the account that owns the API key', async () => {
    const timeService = {
      importDayOffs: jest.fn().mockResolvedValue({
        year: 2026,
        created: 1,
        updated: 0,
        unchanged: 0,
      }),
    };
    const controller = new TimeImportController(timeService as never);
    const dto = { year: 2026, offDays: ['2026-03-10'] };

    await controller.importDayOffs(dto as never, { id: 7 });

    expect(timeService.importDayOffs).toHaveBeenCalledWith(7, dto);
  });

  it('no longer accepts the old shared-secret guard', () => {
    // The routes are guarded by JwtOrApiKeyGuard (personal brk_ keys or a
    // browser session) — see the guard's own spec for the key handling.
    const guards = Reflect.getMetadata(
      '__guards__',
      TimeExportController,
    ) as Array<{ name: string }>;

    expect(guards.map((guard) => guard.name)).toEqual(['JwtOrApiKeyGuard']);
  });
});
