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

  describe('custom keys', () => {
    const custom = {
      provider: 'custom' as const,
      name: 'Local Qwen',
      baseUrl: 'http://192.168.50.35:11434/v1/',
      model: 'qwen3-coder',
    };

    it('needs an address and a model, and a secret unless the scheme is none', async () => {
      await expect(
        service.create(7, { ...custom, apiKey: 'k', baseUrl: undefined }),
      ).rejects.toThrow('address (baseUrl) and a model name');
      await expect(
        service.create(7, { ...custom, apiKey: 'k', model: ' ' }),
      ).rejects.toThrow('address (baseUrl) and a model name');
      await expect(service.create(7, custom)).rejects.toThrow(
        'apiKey is required',
      );
      await expect(
        service.create(7, { provider: 'gpt', name: 'x' }),
      ).rejects.toThrow('apiKey is required');

      await service.create(7, { ...custom, authScheme: 'none' });
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: '', authScheme: 'none' }),
      );
    });

    it('stores the settings, trims the address, keeps only well-formed headers and an empty list as null', async () => {
      await service.create(7, {
        ...custom,
        apiKey: 'k',
        route: 'direct',
        timeoutSec: 900,
        supportsTools: false,
        priceInPerMTok: 0.5,
        extraHeaders: {
          'x-folder-id': 'b1g',
          'bad name': 'x',
          'x-long': 'y'.repeat(501),
        },
        allowedWorkerIds: [],
        preset: 'ollama',
      });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'custom',
          baseUrl: 'http://192.168.50.35:11434/v1',
          route: 'direct',
          authScheme: 'bearer',
          extraHeaders: { 'x-folder-id': 'b1g' },
          timeoutSec: 900,
          supportsTools: false,
          priceInPerMTok: '0.5',
          priceOutPerMTok: null,
          allowedWorkerIds: null,
          preset: 'ollama',
        }),
      );
    });

    it('ignores the custom-only settings on a named provider', async () => {
      await service.create(7, {
        provider: 'gpt',
        name: 'g',
        apiKey: 'k',
        route: 'vpn',
        allowedWorkerIds: [1],
      });

      expect(repository.save).toHaveBeenCalledWith({
        userId: 7,
        provider: 'gpt',
        name: 'g',
        apiKey: 'k',
        baseUrl: null,
        model: null,
      });
    });

    it('hands the worker the whole description of the key it named — and never "the first custom key"', async () => {
      repository.findOneBy.mockResolvedValue({
        provider: 'custom',
        apiKey: '',
        baseUrl: 'http://x/v1',
        model: 'm',
        route: 'direct',
        authScheme: 'none',
        extraHeaders: { 'x-a': '1' },
        timeoutSec: 600,
        supportsTools: false,
      });

      await expect(service.resolveForJob(7, 'custom', 3)).resolves.toEqual({
        apiKey: '',
        baseUrl: 'http://x/v1',
        model: 'm',
        route: 'direct',
        authScheme: 'none',
        extraHeaders: { 'x-a': '1' },
        timeoutSec: 600,
        supportsTools: false,
      });

      repository.findOneBy.mockResolvedValue(null);
      await expect(service.resolveForJob(7, 'custom', 99)).resolves.toBeNull();
      await expect(
        service.resolveForJob(7, 'custom', null),
      ).resolves.toBeNull();
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('lists a custom key without its secret: header names only, a price as a number', () => {
      const dto = ProviderCredentialResponseDto.fromEntity({
        id: 1,
        provider: 'custom',
        name: 'n',
        apiKey: 'sk-secret-1234',
        baseUrl: 'http://x/v1',
        model: 'm',
        route: 'vpn',
        authScheme: 'api-key',
        extraHeaders: { 'x-folder-id': 'b1g' },
        timeoutSec: null,
        supportsTools: true,
        stream: false,
        priceInPerMTok: '0.5000',
        priceOutPerMTok: null,
        preset: null,
        allowedWorkerIds: [5],
        createdAt: new Date(),
      } as never);

      expect(dto).toMatchObject({
        keyHint: '…1234',
        extraHeaderNames: ['x-folder-id'],
        priceInPerMTok: 0.5,
        priceOutPerMTok: null,
        allowedWorkerIds: [5],
      });
      expect(JSON.stringify(dto)).not.toContain('sk-secret');
      expect(JSON.stringify(dto)).not.toContain('b1g');
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
      custom: 0,
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
