import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Worker } from '../worker/entities/worker.entity';
import {
  ENROLL_CODE_PREFIX,
  generateEnrollCode,
  generateWorkerKey,
  hashSecret,
  WORKER_KEY_PREFIX,
  WorkerKeysService,
} from './worker-keys.service';

describe('worker keys and enrollment codes', () => {
  it('a key and a code are long, recognisable and different every time', () => {
    const a = generateWorkerKey();
    const b = generateWorkerKey();
    const code = generateEnrollCode();

    expect(a.key.startsWith(WORKER_KEY_PREFIX)).toBe(true);
    expect(a.key.length).toBeGreaterThan(40);
    expect(a.key).not.toBe(b.key);
    expect(a.prefix).toBe(a.key.slice(0, 12));
    expect(code.code.startsWith(ENROLL_CODE_PREFIX)).toBe(true);
    expect(code.code).not.toBe(generateEnrollCode().code);
  });

  it('only the hash is stored: it is derived from the secret, not the secret itself', () => {
    const { key, hash } = generateWorkerKey();

    expect(hash).toBe(hashSecret(key));
    expect(hash).not.toContain(key);
    expect(hash).toHaveLength(64);
  });

  it('the key prefix and the code prefix differ, so one can never be taken for the other', () => {
    expect(WORKER_KEY_PREFIX).not.toBe(ENROLL_CODE_PREFIX);
    expect(WORKER_KEY_PREFIX.startsWith('brk_')).toBe(false);
  });
});

describe('WorkerKeysService.validate', () => {
  const repository = { findOneBy: jest.fn() };
  let service: WorkerKeysService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        WorkerKeysService,
        { provide: getRepositoryToken(Worker), useValue: repository },
      ],
    }).compile();

    service = module.get(WorkerKeysService);
  });

  it('refuses anything that is not a worker key without a lookup', async () => {
    await expect(service.validate('brk_personal')).resolves.toBeNull();
    await expect(service.validate('')).resolves.toBeNull();
    expect(repository.findOneBy).not.toHaveBeenCalled();
  });

  it('finds the worker by the hash of the key', async () => {
    repository.findOneBy.mockResolvedValue({ id: 5, userId: 7 });

    await expect(service.validate('brw_secret')).resolves.toEqual({
      userId: 7,
      workerId: 5,
    });
    expect(repository.findOneBy).toHaveBeenCalledWith({
      keyHash: hashSecret('brw_secret'),
    });
  });

  it('is null for a key that matches no worker (deleted, or renewed)', async () => {
    repository.findOneBy.mockResolvedValue(null);

    await expect(service.validate('brw_gone')).resolves.toBeNull();
  });
});
