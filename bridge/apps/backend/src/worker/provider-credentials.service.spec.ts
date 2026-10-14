import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ProviderCredentialResponseDto } from './dto/provider-credential-response.dto';
import { ProviderCredential } from './entities/provider-credential.entity';
import { ProviderCredentialsService } from './provider-credentials.service';

describe('ProviderCredentialsService', () => {
  const repository = {
    create: jest.fn((value: unknown) => value),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
    find: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    existsBy: jest.fn(),
    delete: jest.fn(),
  };
  let service: ProviderCredentialsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ProviderCredentialsService,
        {
          provide: getRepositoryToken(ProviderCredential),
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get(ProviderCredentialsService);
  });

  it('trims what is stored and turns empty optional fields into null', async () => {
    await service.create(7, {
      provider: 'gpt',
      name: '  personal ',
      apiKey: '  sk-abc  ',
      baseUrl: ' ',
      model: '',
    });

    expect(repository.save).toHaveBeenCalledWith({
      userId: 7,
      provider: 'gpt',
      name: 'personal',
      apiKey: 'sk-abc',
      baseUrl: null,
      model: null,
    });
  });

  describe('resolveForJob', () => {
    it('is null for a Claude model — it has its own credential', async () => {
      await expect(
        service.resolveForJob(7, 'sonnet', null),
      ).resolves.toBeNull();
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('uses the credential the job named, when it is the account’s and the provider’s', async () => {
      repository.findOneBy.mockResolvedValue({
        apiKey: 'sk-named',
        baseUrl: 'https://x/v1',
        model: 'm',
      });

      await expect(service.resolveForJob(7, 'gpt', 3)).resolves.toEqual({
        apiKey: 'sk-named',
        baseUrl: 'https://x/v1',
        model: 'm',
      });
      expect(repository.findOneBy).toHaveBeenCalledWith({
        id: 3,
        userId: 7,
        provider: 'gpt',
      });
    });

    it('falls back to the account’s first key for the provider', async () => {
      repository.findOne.mockResolvedValue({
        apiKey: 'sk-first',
        baseUrl: null,
        model: null,
      });

      await expect(service.resolveForJob(7, 'deepseek', null)).resolves.toEqual(
        { apiKey: 'sk-first', baseUrl: null, model: null },
      );
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { userId: 7, provider: 'deepseek' },
        order: { id: 'ASC' },
      });
    });

    it('falls back when the named credential is gone', async () => {
      repository.findOneBy.mockResolvedValue(null);
      repository.findOne.mockResolvedValue({
        apiKey: 'sk-first',
        baseUrl: null,
        model: null,
      });

      await expect(service.resolveForJob(7, 'qwen', 99)).resolves.toMatchObject(
        {
          apiKey: 'sk-first',
        },
      );
    });

    it('is null when the account has no key for the provider (the worker then uses its own environment)', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.resolveForJob(7, 'gpt', null)).resolves.toBeNull();
    });
  });

  it('counts keys per provider, zero for the ones without', async () => {
    repository.find.mockResolvedValue([
      { provider: 'gpt' },
      { provider: 'gpt' },
      { provider: 'qwen' },
    ]);

    await expect(service.countsByProvider(7)).resolves.toEqual({
      gpt: 2,
      deepseek: 0,
      qwen: 1,
    });
  });

  it('removing something that is not the account’s is a 404', async () => {
    repository.delete.mockResolvedValue({ affected: 0 });

    await expect(service.remove(1, 7)).rejects.toThrow(
      'Provider credential not found',
    );
  });
});

describe('ProviderCredentialResponseDto', () => {
  it('never carries the key — only the last four characters as a hint', () => {
    const dto = ProviderCredentialResponseDto.fromEntity({
      id: 1,
      provider: 'gpt',
      name: 'n',
      apiKey: 'sk-very-secret-1234',
      baseUrl: null,
      model: null,
      createdAt: new Date(),
    } as ProviderCredential);

    expect(dto.keyHint).toBe('…1234');
    expect(JSON.stringify(dto)).not.toContain('very-secret');
  });
});
