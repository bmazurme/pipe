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

  it('still lets an API key read the list', () => {
    expect(guardsOf(proto.list)).toEqual([JwtOrApiKeyGuard]);
  });

  it('has no class-level guard that would widen the writes', () => {
    expect(guardsOf(ClaudeCredentialsController)).toEqual([]);
  });
});
