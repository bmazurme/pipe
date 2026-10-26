import { GUARDS_METADATA } from '@nestjs/common/constants';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { ClaudeCredentialsController } from './claude-credentials.controller';

const guardsOf = (target: object): unknown[] =>
  Reflect.getMetadata(GUARDS_METADATA, target) ?? [];

describe('ClaudeCredentialsController guards', () => {
  const proto = ClaudeCredentialsController.prototype;

  it('requires a browser session to create a token', () => {
    expect(guardsOf(proto.create)).toEqual([JwtGuard]);
  });

  it('requires a browser session to delete a token', () => {
    expect(guardsOf(proto.remove)).toEqual([JwtGuard]);
  });

  it('requires a browser session to replace a token', () => {
    expect(guardsOf(proto.replaceToken)).toEqual([JwtGuard]);
  });

  it('still lets an API key read the list', () => {
    expect(guardsOf(proto.list)).toEqual([JwtOrApiKeyGuard]);
  });

  it('has no class-level guard that would widen the writes', () => {
    expect(guardsOf(ClaudeCredentialsController)).toEqual([]);
  });
});

describe('ClaudeCredentialsController list usage7d', () => {
  it('attaches the 7-day usage to each token, null when it has none', async () => {
    const service = {
      findAllByUser: jest.fn().mockResolvedValue([
        { id: 1, name: 'a', createdAt: new Date() },
        { id: 2, name: 'b', createdAt: new Date() },
      ]),
      recentUsage: jest
        .fn()
        .mockResolvedValue(
          new Map([[1, { runs: 2, costUsd: 1.5, tokens: 10 }]]),
        ),
    };
    const controller = new ClaudeCredentialsController(service as never);

    const result = await controller.list({ id: 5 });

    expect(result[0].usage7d).toEqual({ runs: 2, costUsd: 1.5, tokens: 10 });
    expect(result[1].usage7d).toBeNull();
    expect(service.recentUsage).toHaveBeenCalledWith(5, expect.any(Date));
  });
});

describe('ClaudeCredentialsController replaceToken', () => {
  it('returns the credential without the token', async () => {
    const service = {
      replaceToken: jest.fn().mockResolvedValue({
        id: 3,
        name: 'a',
        token: 'secret',
        createdAt: new Date(),
        limits: null,
        authFailedAt: null,
        authFailedJobId: null,
      }),
    };
    const controller = new ClaudeCredentialsController(service as never);

    const result = await controller.replaceToken(
      3,
      { token: 'secret' },
      { id: 5 },
    );

    expect(service.replaceToken).toHaveBeenCalledWith(3, 5, 'secret');
    expect(result).not.toHaveProperty('token');
    expect(result.authFailedAt).toBeNull();
  });
});
