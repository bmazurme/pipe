import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateClaudeCredentialDto } from './update-claude-credential.dto';

const errorsFor = (body: unknown) =>
  validate(plainToInstance(UpdateClaudeCredentialDto, body));

describe('UpdateClaudeCredentialDto', () => {
  it('accepts a token', async () => {
    expect(await errorsFor({ token: 'sk-ant-oat-x' })).toHaveLength(0);
  });

  it('rejects an empty or missing token', async () => {
    expect(await errorsFor({ token: '' })).not.toHaveLength(0);
    expect(await errorsFor({})).not.toHaveLength(0);
  });

  it('rejects whitespace, a newline and an over-long token', async () => {
    expect(await errorsFor({ token: 'a b' })).not.toHaveLength(0);
    expect(await errorsFor({ token: 'a\tb' })).not.toHaveLength(0);
    expect(await errorsFor({ token: 'a\nb' })).not.toHaveLength(0);
    expect(await errorsFor({ token: 'a'.repeat(2001) })).not.toHaveLength(0);
    expect(await errorsFor({ token: 'a'.repeat(2000) })).toHaveLength(0);
  });

  it('trims surrounding whitespace', async () => {
    const dto = plainToInstance(UpdateClaudeCredentialDto, {
      token: '  tok\n',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.token).toBe('tok');
  });
});
