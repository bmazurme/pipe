import { strToU8, unzipSync, zipSync } from 'fflate';

import { ImproveHandoffService } from './improve-handoff.service';
import * as parcel from './parcel';
import { MANIFEST_ENTRY } from './parcel';

function setup() {
  const github = {
    repoName: jest.fn().mockReturnValue('o/r'),
    baseBranch: jest.fn().mockReturnValue('main'),
    getBranchSha: jest.fn().mockResolvedValue('base-sha'),
    downloadZipball: jest.fn().mockResolvedValue(
      zipSync({
        'o-r-sha/a.ts': strToU8('one'),
        'o-r-sha/b.ts': strToU8('two'),
      }),
    ),
  };
  const storage = {
    createFromBuffer: jest.fn().mockResolvedValue({ id: 99 }),
  };
  const workers = { create: jest.fn().mockResolvedValue({ id: 321 }) };
  const service = new ImproveHandoffService(
    github as never,
    storage as never,
    workers as never,
  );

  return { service, github, storage, workers };
}

const task = { number: 7, title: 'Fix it', body: 'b' };

describe('ImproveHandoffService zipball reuse', () => {
  it('downloads the zipball once for several snapshots on the same SHA', async () => {
    const { service, github } = setup();

    const first = await service.prepareSnapshot();
    const second = await service.prepareSnapshot();
    await service.snapshotAt('base-sha');

    expect(github.downloadZipball).toHaveBeenCalledTimes(1);
    expect(github.downloadZipball).toHaveBeenCalledWith('base-sha');
    expect(second.files).toBe(first.files);
    expect(second.baseline).toBe(first.baseline);
  });

  it('downloads again when the SHA changes', async () => {
    const { service, github } = setup();
    github.getBranchSha
      .mockResolvedValueOnce('sha-1')
      .mockResolvedValueOnce('sha-1')
      .mockResolvedValue('sha-2');

    await service.prepareSnapshot();
    await service.prepareSnapshot();
    await service.prepareSnapshot();

    expect(github.downloadZipball).toHaveBeenCalledTimes(2);
    expect(github.downloadZipball).toHaveBeenNthCalledWith(1, 'sha-1');
    expect(github.downloadZipball).toHaveBeenNthCalledWith(2, 'sha-2');
  });

  it('shares one in-flight download between concurrent snapshots of one SHA', async () => {
    const { service, github } = setup();
    let release: (bytes: Uint8Array) => void = () => undefined;
    github.downloadZipball.mockReturnValueOnce(
      new Promise<Uint8Array>((resolve) => (release = resolve)),
    );

    github.getBranchSha.mockResolvedValue('sha-1');
    const pending = Promise.all([
      service.snapshotAt('sha-1'),
      service.snapshotAt('sha-1'),
      service.prepareSnapshot('feature'),
    ]);
    await new Promise((resolve) => setImmediate(resolve));
    release(zipSync({ 'o-r-sha/a.ts': strToU8('one') }));
    const [a, b, c] = await pending;

    expect(github.downloadZipball).toHaveBeenCalledTimes(1);
    expect(b.files).toBe(a.files);
    expect(c.files).toBe(a.files);
  });

  it('downloads again once the cached entry is older than the TTL', async () => {
    const { service, github } = setup();
    const t0 = Date.now();
    const now = jest.spyOn(Date, 'now');
    try {
      now.mockReturnValue(t0);
      await service.snapshotAt('base-sha');
      now.mockReturnValue(t0 + 11 * 60 * 1000);
      await service.snapshotAt('base-sha');
    } finally {
      now.mockRestore();
    }

    expect(github.downloadZipball).toHaveBeenCalledTimes(2);
  });
});

describe('ImproveHandoffService snapshot baseline reuse', () => {
  let hash: jest.SpyInstance;
  beforeEach(() => {
    hash = jest.spyOn(parcel, 'snapshotBaseline');
  });
  afterEach(() => hash.mockRestore());

  it('hashes the snapshot once per SHA', async () => {
    const { service } = setup();

    await service.snapshotAt('sha-1');
    await service.snapshotAt('sha-1');
    expect(hash).toHaveBeenCalledTimes(1);

    await service.snapshotAt('sha-2');
    expect(hash).toHaveBeenCalledTimes(2);
  });
});

describe('ImproveHandoffService.handToWorker', () => {
  it('builds the parcel, stores it and starts a worker job', async () => {
    const { service, storage, workers } = setup();

    const result = await service.handToWorker(
      3,
      'sonnet',
      task,
      'improve:7',
      'improve-7.subscription.zip',
      undefined,
      undefined,
      4,
    );

    expect(storage.createFromBuffer).toHaveBeenCalledWith(
      3,
      expect.any(Buffer),
      'improve-7.subscription.zip',
      expect.objectContaining({ channel: 'issue', taskKey: 'improve:7' }),
    );
    expect(workers.create).toHaveBeenCalledWith(3, {
      sourceFileId: 99,
      model: 'sonnet',
      contextId: 4,
    });
    expect(result).toEqual(
      expect.objectContaining({
        job: { id: 321 },
        baseSha: 'base-sha',
        fileCount: 2,
      }),
    );
    const zip = unzipSync(
      new Uint8Array(storage.createFromBuffer.mock.calls[0][1] as Buffer),
    );
    expect(Object.keys(zip)).toContain(MANIFEST_ENTRY);
  });

  it('snapshots the given branch head instead of the base branch', async () => {
    const { service, github, workers } = setup();

    const result = await service.handToWorker(
      3,
      'opus',
      task,
      'improve:7',
      'f.zip',
      { sha: 'head-sha', branch: 'improve/7' },
    );

    expect(github.getBranchSha).not.toHaveBeenCalled();
    expect(github.downloadZipball).toHaveBeenCalledWith('head-sha');
    expect(result.baseSha).toBe('head-sha');
    expect(workers.create).toHaveBeenCalledWith(3, {
      sourceFileId: 99,
      model: 'opus',
    });
  });
});
