import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { strToU8, zipSync } from 'fflate';

import { JobStatus } from '../worker/entities/job.entity';
import { LabDigest, LabDigestStatus } from './entities/lab-digest.entity';
import { clearPublicRepoCache } from './lab-digest';
import { LabDigestService } from './lab-digest.service';

jest.mock('../improve/issue-job', () => ({
  launchIssueJob: jest.fn().mockResolvedValue({ job: { id: 99 } }),
}));

import { launchIssueJob } from '../improve/issue-job';

const NOW = new Date('2026-11-11T10:00:00Z');
const WEEK = '2026-11-09';

const queryBuilder = (
  many: unknown[],
  raw?: { entities: unknown[]; raw: unknown[] },
) => {
  const builder: Record<string, jest.Mock> = {};

  for (const name of [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'orderBy',
    'limit',
    'setParameter',
  ]) {
    builder[name] = jest.fn(() => builder);
  }

  builder.getMany = jest.fn().mockResolvedValue(many);
  builder.getRawAndEntities = jest
    .fn()
    .mockResolvedValue(raw ?? { entities: [], raw: [] });

  return builder;
};

const labRun = (over: Record<string, unknown> = {}) => ({
  id: 5,
  title: 'Обновить зависимости',
  repo: 'bmazurme/pipe',
  status: 'pr_open',
  prUrl: 'https://github.com/bmazurme/pipe/pull/9',
  issueUrl: null,
  finishedAt: new Date('2026-11-10T09:00:00Z'),
  jobId: 70,
  ...over,
});

function setup({
  lab = [] as unknown[],
  improve = [] as unknown[],
  parcels = [] as unknown[],
  existing = null as Partial<LabDigest> | null,
  settings = null as Record<string, unknown> | null,
} = {}) {
  const saved: LabDigest[] = [];
  const digests = {
    findOne: jest.fn().mockResolvedValue(existing),
    create: jest.fn((row: Partial<LabDigest>) => ({ ...row })),
    save: jest.fn(async (row: LabDigest) => {
      if (!row.id) row.id = 1;

      saved.push({ ...row });

      return row;
    }),
    find: jest.fn().mockResolvedValue([]),
    exist: jest.fn().mockResolvedValue(false),
    delete: jest.fn(),
  };
  const settingsRepo = {
    findOne: jest.fn().mockResolvedValue(settings),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((row: unknown) => row),
    save: jest.fn(),
  };
  const labRuns = {
    createQueryBuilder: jest.fn(() => queryBuilder(lab)),
    find: jest.fn().mockResolvedValue([]),
  };
  const improveRuns = {
    createQueryBuilder: jest.fn(() => queryBuilder(improve)),
    find: jest.fn().mockResolvedValue([]),
  };
  const jobs = {
    createQueryBuilder: jest.fn(() =>
      queryBuilder(parcels, {
        entities: [{ id: 70, model: 'haiku', usage: { costUsd: 0.5 } }],
        raw: [{ logsTail: 'Готово: PR открыт' }],
      }),
    ),
  };
  const storage = {
    findOwned: jest.fn().mockResolvedValue({ id: 3 }),
    readBytes: jest.fn(),
  };
  const workers = { findStatuses: jest.fn().mockResolvedValue([]) };
  const github = { repoName: jest.fn().mockReturnValue('bmazurme/pipe') };
  const service = new LabDigestService(
    digests as never,
    settingsRepo as never,
    labRuns as never,
    improveRuns as never,
    jobs as never,
    storage as never,
    workers as never,
    github as never,
  );

  return { service, digests, saved, storage, workers, jobs, labRuns };
}

describe('LabDigestService', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['setImmediate', 'nextTick'] });
    clearPublicRepoCache();
    (launchIssueJob as jest.Mock).mockClear();
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ status: 200 } as Response);
  });

  afterEach(() => {
    jest.useRealTimers();
    fetchSpy.mockRestore();
  });

  describe('start', () => {
    it('refuses a day that is not a Monday and a week that has not begun', async () => {
      const { service } = setup();

      await expect(
        service.start(7, { weekStart: '2026-11-10' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.start(7, { weekStart: '2026-11-16' }),
      ).rejects.toThrow('ещё не началась');
    });

    it('refuses an unknown model, and "auto"', async () => {
      const { service } = setup();

      await expect(
        service.start(7, { weekStart: WEEK, model: 'auto' }),
      ).rejects.toThrow('Неизвестная модель');
    });

    it('says so when the week is empty', async () => {
      const { service } = setup();

      await expect(service.start(7, { weekStart: WEEK })).rejects.toThrow(
        'нет завершённых работ',
      );
      expect(launchIssueJob).not.toHaveBeenCalled();
    });

    it('leaves private work out by default and tells how much', async () => {
      fetchSpy.mockResolvedValue({ status: 404 } as Response);

      const { service } = setup({ lab: [labRun()] });

      await expect(service.start(7, { weekStart: WEEK })).rejects.toThrow(
        'скрыто приватных: 1',
      );
    });

    it('starts a worker job over the public work and keeps the items', async () => {
      const { service, saved } = setup({ lab: [labRun()] });

      const digest = await service.start(7, { weekStart: WEEK });

      expect(digest.status).toBe(LabDigestStatus.Generating);
      expect(digest.jobId).toBe(99);
      expect(digest.model).toBe('haiku');
      expect(digest.includePrivate).toBe(false);
      expect(digest.items).toHaveLength(1);
      expect(digest.items[0]).toMatchObject({
        source: 'lab',
        repo: 'bmazurme/pipe',
        costUsd: 0.5,
        model: 'haiku',
      });
      expect(saved[0].noteType).toBe('Dev Work Diary');

      const call = (launchIssueJob as jest.Mock).mock.calls[0][1];

      expect(call.taskKey).toBe(`lab-digest:${digest.id}`);
      expect(call.files[0].path).toBe('digest-input.md');
      expect(new TextDecoder().decode(call.files[0].bytes)).toContain(
        'Готово: PR открыт',
      );
      expect(call.task.body).toContain('digest.json');
    });

    it('takes private work and parcels in only when asked', async () => {
      fetchSpy.mockResolvedValue({ status: 404 } as Response);

      const { service } = setup({
        lab: [labRun()],
        parcels: [
          {
            id: 80,
            taskKey: '12:34',
            model: 'sonnet',
            finishedAt: new Date('2026-11-10T10:00:00Z'),
          },
        ],
      });

      const digest = await service.start(7, {
        weekStart: WEEK,
        includePrivate: true,
      });

      expect(digest.items.map((i) => i.source).sort()).toEqual([
        'lab',
        'parcel',
      ]);
      expect(digest.excludedPrivate).toBe(0);
    });

    it('refuses a second start while one is being written, but makes a finished one again', async () => {
      const busy = setup({
        lab: [labRun()],
        existing: { id: 4, status: LabDigestStatus.Generating },
      });

      await expect(
        busy.service.start(7, { weekStart: WEEK }),
      ).rejects.toBeInstanceOf(ConflictException);

      const again = setup({
        lab: [labRun()],
        existing: {
          id: 4,
          userId: 7,
          weekStart: WEEK,
          status: LabDigestStatus.Draft,
          content: 'старый текст',
        },
      });
      const digest = await again.service.start(7, { weekStart: WEEK });

      expect(digest.id).toBe(4);
      expect(digest.status).toBe(LabDigestStatus.Generating);
      expect(digest.content).toBeNull();
    });

    it('marks the digest failed when the job cannot be made', async () => {
      (launchIssueJob as jest.Mock).mockRejectedValueOnce(
        new Error('нет свободного worker'),
      );

      const { service } = setup({ lab: [labRun()] });
      const digest = await service.start(7, { weekStart: WEEK });

      expect(digest.status).toBe(LabDigestStatus.Failed);
      expect(digest.error).toBe('нет свободного worker');
    });
  });

  describe('advanceOne', () => {
    const generating = (over: Partial<LabDigest> = {}) =>
      ({
        id: 1,
        userId: 7,
        status: LabDigestStatus.Generating,
        jobId: 99,
        updatedAt: new Date(NOW.getTime() - 60_000),
        ...over,
      }) as LabDigest;

    it('turns a finished job into a draft', async () => {
      const { service, storage, digests } = setup();

      storage.readBytes.mockResolvedValue(
        Buffer.from(
          zipSync({
            'digest.json': strToU8(
              JSON.stringify({
                title: 'Неделя 9–15 ноября',
                preview: 'Коротко.',
                content: '## Итоги\n\nСделано три работы.',
                tags: ['lab'],
              }),
            ),
            '__subscription_manifest__.json': strToU8('{}'),
          }),
        ),
      );

      const row = generating();

      await service.advanceOne(row, {
        id: 99,
        userId: 7,
        status: JobStatus.Succeeded,
        resultFileId: 3,
        errorMessage: null,
      });

      expect(row.status).toBe(LabDigestStatus.Draft);
      expect(row.title).toBe('Неделя 9–15 ноября');
      expect(row.tags).toEqual(['lab']);
      expect(digests.save).toHaveBeenCalled();
    });

    it('fails with the reason when the worker made no digest.json', async () => {
      const { service, storage } = setup();

      storage.readBytes.mockResolvedValue(
        Buffer.from(zipSync({ 'other.txt': strToU8('x') })),
      );

      const row = generating();

      await service.advanceOne(row, {
        id: 99,
        userId: 7,
        status: JobStatus.Succeeded,
        resultFileId: 3,
        errorMessage: null,
      });

      expect(row.status).toBe(LabDigestStatus.Failed);
      expect(row.error).toContain('digest.json');
    });

    it("fails when the job failed, and keeps the worker's reason", async () => {
      const { service } = setup();
      const row = generating();

      await service.advanceOne(row, {
        id: 99,
        userId: 7,
        status: JobStatus.Failed,
        resultFileId: null,
        errorMessage: 'лимит исчерпан',
      });

      expect(row.status).toBe(LabDigestStatus.Failed);
      expect(row.error).toBe('лимит исчерпан');
    });

    it('waits while the job runs, and fails a row whose job vanished', async () => {
      const { service } = setup();
      const waiting = generating();

      await service.advanceOne(waiting, {
        id: 99,
        userId: 7,
        status: JobStatus.Running,
        resultFileId: null,
        errorMessage: null,
      });
      expect(waiting.status).toBe(LabDigestStatus.Generating);

      const lost = generating();

      await service.advanceOne(lost, undefined);
      expect(lost.status).toBe(LabDigestStatus.Failed);
    });

    it('fails a row that never got a job after ten minutes, not before', async () => {
      const { service } = setup();
      const fresh = generating({ jobId: null });

      await service.advanceOne(fresh, undefined, NOW.getTime());
      expect(fresh.status).toBe(LabDigestStatus.Generating);

      const stale = generating({
        jobId: null,
        updatedAt: new Date(NOW.getTime() - 11 * 60_000),
      });

      await service.advanceOne(stale, undefined, NOW.getTime());
      expect(stale.status).toBe(LabDigestStatus.Failed);
    });
  });

  describe('editing', () => {
    it('edits a draft, tidies the tags, and refuses a digest still being written', async () => {
      const draft = setup();

      draft.digests.findOne.mockResolvedValue({
        id: 1,
        userId: 7,
        status: LabDigestStatus.Draft,
        tags: [],
      });

      const row = await draft.service.update(1, 7, {
        title: 'Новый',
        tags: ['A b', 'a b'],
      });

      expect(row.title).toBe('Новый');
      expect(row.tags).toEqual(['a-b']);

      const busy = setup();

      busy.digests.findOne.mockResolvedValue({
        id: 1,
        userId: 7,
        status: LabDigestStatus.Generating,
      });
      await expect(
        busy.service.update(1, 7, { title: 'X1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('marks a draft as carried over to notes', async () => {
      const { service, digests } = setup();

      digests.findOne.mockResolvedValue({
        id: 1,
        userId: 7,
        status: LabDigestStatus.Draft,
        content: 'текст',
      });

      const row = await service.markExported(1, 7);

      expect(row.status).toBe(LabDigestStatus.Exported);
      expect(row.exportedAt).toBeInstanceOf(Date);
    });
  });

  describe('automatic weekly digest', () => {
    it('does nothing before Monday 06:00 and once per week and account after', async () => {
      const { service, digests } = setup({ lab: [labRun()] });
      const settingsRepo = (
        service as never as { settings: { find: jest.Mock } }
      ).settings;

      settingsRepo.find.mockResolvedValue([{ userId: 7, autoWeekly: true }]);

      await service.autoWeekly(new Date('2026-11-09T02:00:00Z'));
      expect(launchIssueJob).not.toHaveBeenCalled();

      // The week that just ended is 2026-11-02; its work is the same stub rows.
      await service.autoWeekly(new Date('2026-11-09T04:00:00Z'));
      expect(launchIssueJob).toHaveBeenCalledTimes(1);
      expect(digests.save).toHaveBeenCalled();

      await service.autoWeekly(new Date('2026-11-09T04:20:00Z'));
      expect(launchIssueJob).toHaveBeenCalledTimes(1);
    });

    it('skips a week that already has a digest', async () => {
      const { service, digests } = setup({ lab: [labRun()] });
      const settingsRepo = (
        service as never as { settings: { find: jest.Mock } }
      ).settings;

      settingsRepo.find.mockResolvedValue([{ userId: 7, autoWeekly: true }]);
      digests.exist.mockResolvedValue(true);

      await service.autoWeekly(new Date('2026-11-09T04:00:00Z'));

      expect(launchIssueJob).not.toHaveBeenCalled();
    });
  });

  describe('notes settings and sending', () => {
    const KEY = 'k'.repeat(40);
    const draft = (over: Partial<LabDigest> = {}) => ({
      id: 1,
      userId: 7,
      status: LabDigestStatus.Draft,
      title: 'Неделя 2–8 ноября',
      preview: 'Коротко',
      content: '## Итоги\n\nСделано.',
      tags: ['lab'],
      noteType: 'Dev Work Diary',
      noteId: null,
      ...over,
    });
    const answer = (status: number, body: unknown = {}) =>
      ({
        status,
        ok: status >= 200 && status < 300,
        clone() {
          return this;
        },
        json: async () => body,
      }) as unknown as Response;

    it('keeps the key write-only: the view has only its last characters', async () => {
      const { service } = setup();
      const settings = (
        service as never as {
          settings: { findOne: jest.Mock; save: jest.Mock };
        }
      ).settings;
      const saved: Record<string, unknown>[] = [];

      settings.findOne.mockResolvedValue(null);
      settings.save.mockImplementation(async (row: Record<string, unknown>) => {
        saved.push({ ...row });
        settings.findOne.mockResolvedValue(row);
      });

      const view = await service.saveSettings(7, {
        notesKey: ` ${KEY}abcd `,
        notesUrl: 'https://notes.example.dev/x',
      });

      expect(saved[0]).toMatchObject({
        notesKey: `${KEY}abcd`,
        notesKeyHint: 'abcd',
        notesUrl: 'https://notes.example.dev',
      });
      expect(view).toMatchObject({
        hasNotesKey: true,
        notesKeyHint: 'abcd',
        notesUrl: 'https://notes.example.dev',
      });
      expect(JSON.stringify(view)).not.toContain(KEY);

      const cleared = await service.saveSettings(7, { notesKey: '' });

      expect(cleared).toMatchObject({ hasNotesKey: false, notesKeyHint: null });
    });

    it('refuses a short key and a bad address', async () => {
      const { service } = setup();

      await expect(
        service.saveSettings(7, { notesKey: 'short' }),
      ).rejects.toThrow('слишком короткий');
      await expect(
        service.saveSettings(7, { notesUrl: 'http://10.0.0.1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('defaults to notes.ntlstl.dev and no key', async () => {
      const { service } = setup();

      expect(await service.getSettings(7)).toMatchObject({
        notesUrl: 'https://notes.ntlstl.dev',
        hasNotesKey: false,
        notesKeyHint: null,
      });
    });

    it('sends a draft and records the note id', async () => {
      const { service, digests } = setup({
        settings: {
          userId: 7,
          notesKey: KEY,
          notesUrl: 'https://notes.example.dev',
        },
      });

      digests.findOne.mockResolvedValue(draft());
      fetchSpy.mockImplementation(async (url: string) =>
        url.endsWith('/api/v1/types')
          ? answer(200, [{ id: 6, name: 'Dev Work Diary' }])
          : answer(201, { id: 42, slug: 's' }),
      );

      const row = await service.send(1, 7);

      expect(row.noteId).toBe(42);
      expect(row.status).toBe(LabDigestStatus.Exported);
      expect(row.sentAt).toBeInstanceOf(Date);
      expect(fetchSpy.mock.calls[1][0]).toBe(
        'https://notes.example.dev/api/v1/notes/drafts',
      );
    });

    it('does not send twice, without a key, or what is not ready', async () => {
      const sent = setup({ settings: { userId: 7, notesKey: KEY } });

      sent.digests.findOne.mockResolvedValue(draft({ noteId: 5 }));
      await expect(sent.service.send(1, 7)).rejects.toBeInstanceOf(
        ConflictException,
      );

      const keyless = setup({ settings: { userId: 7, notesKey: null } });

      keyless.digests.findOne.mockResolvedValue(draft());
      await expect(keyless.service.send(1, 7)).rejects.toThrow(
        'Ключ notes не задан',
      );

      const busy = setup({ settings: { userId: 7, notesKey: KEY } });

      busy.digests.findOne.mockResolvedValue(
        draft({ status: LabDigestStatus.Generating, content: null }),
      );
      await expect(busy.service.send(1, 7)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('turns what the site says into 400 (fixable here) or 502 (try later), and keeps the draft unsent', async () => {
      const wrongKey = setup({ settings: { userId: 7, notesKey: KEY } });
      const row = draft();

      wrongKey.digests.findOne.mockResolvedValue(row);
      fetchSpy.mockImplementation(async (url: string) =>
        url.endsWith('/api/v1/types')
          ? answer(200, [{ id: 6, name: 'Dev Work Diary' }])
          : answer(401),
      );
      await expect(wrongKey.service.send(1, 7)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      fetchSpy.mockImplementation(async (url: string) =>
        url.endsWith('/api/v1/types')
          ? answer(200, [{ id: 6, name: 'Dev Work Diary' }])
          : answer(500),
      );
      await expect(wrongKey.service.send(1, 7)).rejects.toBeInstanceOf(
        BadGatewayException,
      );
      expect(row.noteId).toBeNull();
      expect(wrongKey.digests.save).not.toHaveBeenCalled();
    });
  });
});
