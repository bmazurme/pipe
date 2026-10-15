import { ClaudeCredentialsService } from './claude-credentials.service';
import { ProviderCredentialsService } from './provider-credentials.service';
import { RunCredentialsService } from './run-credentials.service';
import { WorkersService } from './workers.service';

describe('RunCredentialsService', () => {
  const claude = { resolveForRun: jest.fn() };
  const providers = { resolveForJob: jest.fn() };
  const workers = { claudeCredentialIdOf: jest.fn() };
  let service: RunCredentialsService;

  beforeEach(() => {
    jest.resetAllMocks();
    claude.resolveForRun.mockResolvedValue({ id: 4, token: 'tok' });
    providers.resolveForJob.mockResolvedValue(null);
    workers.claudeCredentialIdOf.mockResolvedValue(6);
    service = new RunCredentialsService(
      claude as unknown as ClaudeCredentialsService,
      providers as unknown as ProviderCredentialsService,
      workers as unknown as WorkersService,
    );
  });

  it('gives a Claude model the token the job picked, then the worker’s', async () => {
    const result = await service.resolve(7, 3, 'sonnet', {
      claudeCredentialId: 9,
    });

    expect(claude.resolveForRun).toHaveBeenCalledWith(7, 9, 6);
    expect(result).toMatchObject({ claudeToken: 'tok', claudeCredentialId: 4 });
  });

  it('falls back to the worker’s token when the job picked none', async () => {
    await service.resolve(7, 3, 'opus', {});

    expect(workers.claudeCredentialIdOf).toHaveBeenCalledWith(3);
    expect(claude.resolveForRun).toHaveBeenCalledWith(7, null, 6);
  });

  it('falls back to the account’s first token when there is no worker token', async () => {
    workers.claudeCredentialIdOf.mockResolvedValue(null);
    await service.resolve(7, 3, 'sonnet');
    expect(claude.resolveForRun).toHaveBeenCalledWith(7, null, null);

    await service.resolve(7, undefined, 'sonnet');
    expect(workers.claudeCredentialIdOf).toHaveBeenCalledTimes(1);
    expect(claude.resolveForRun).toHaveBeenLastCalledWith(7, null, null);
  });

  it('returns no token when nothing resolves', async () => {
    claude.resolveForRun.mockResolvedValue(null);

    expect(await service.resolve(7, 3, 'sonnet')).toMatchObject({
      claudeToken: null,
      claudeCredentialId: null,
    });
  });

  it('gives a non-Claude model no Claude token', async () => {
    const result = await service.resolve(7, 3, 'gpt');

    expect(claude.resolveForRun).not.toHaveBeenCalled();
    expect(result.claudeToken).toBeNull();
    expect(result.claudeCredentialId).toBeNull();
  });

  it('resolves a provider model with and without a credential id', async () => {
    const provider = { apiKey: 'k', baseUrl: null, model: null };
    providers.resolveForJob.mockResolvedValue(provider);

    const withId = await service.resolve(7, 3, 'gpt', {
      providerCredentialId: 12,
    });

    expect(providers.resolveForJob).toHaveBeenLastCalledWith(7, 'gpt', 12);
    expect(withId.provider).toBe(provider);

    await service.resolve(7, 3, 'deepseek');
    expect(providers.resolveForJob).toHaveBeenLastCalledWith(
      7,
      'deepseek',
      null,
    );
  });
});
