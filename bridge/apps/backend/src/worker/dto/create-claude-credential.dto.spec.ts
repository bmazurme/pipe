import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateClaudeCredentialDto } from './create-claude-credential.dto';

const build = (body: unknown) =>
  plainToInstance(CreateClaudeCredentialDto, body);

describe('CreateClaudeCredentialDto', () => {
  it('accepts a name and a token', async () => {
    const dto = build({ name: 'main', token: 'sk-ant-oat-x' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects internal whitespace, a newline and a tab', async () => {
    for (const token of ['a b', 'a\nb', 'a\tb']) {
      expect(await validate(build({ name: 'n', token }))).not.toHaveLength(0);
    }
  });

  it('enforces the length limit', async () => {
    const tooLong = build({ name: 'n', token: 'a'.repeat(2001) });
    const atLimit = build({ name: 'n', token: 'a'.repeat(2000) });
    expect(await validate(tooLong)).not.toHaveLength(0);
    expect(await validate(atLimit)).toHaveLength(0);
  });

  it('trims surrounding whitespace', async () => {
    const dto = build({ name: 'n', token: ' tok \n' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.token).toBe('tok');
  });

  it('rejects a whitespace-only token', async () => {
    const dto = build({ name: 'n', token: '  ' });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
