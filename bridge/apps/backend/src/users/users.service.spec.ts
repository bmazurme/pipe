import { getMetadataArgsStorage } from 'typeorm';
import type { ValueTransformer } from 'typeorm';

import { User } from './entities/user.entity';

describe('User.purgeDraft column', () => {
  const originalKey = process.env.CREDENTIALS_ENC_KEY;

  beforeAll(() => {
    process.env.CREDENTIALS_ENC_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.CREDENTIALS_ENC_KEY;
    else process.env.CREDENTIALS_ENC_KEY = originalKey;
  });

  function options() {
    const col = getMetadataArgsStorage().columns.find(
      (c) => c.target === User && c.propertyName === 'purgeDraft',
    );

    if (!col) throw new Error('purgeDraft column not found');

    return {
      select: col.options.select,
      transformer: col.options.transformer as ValueTransformer,
    };
  }

  it('is not selected by default', () => {
    expect(options().select).toBe(false);
  });

  it('stores ciphertext and round-trips', () => {
    const { transformer } = options();
    const stored = transformer.to('real host db.internal') as string;

    expect(stored).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(stored).not.toContain('db.internal');
    expect(transformer.from(stored)).toBe('real host db.internal');
  });

  it('returns legacy plaintext unchanged', () => {
    expect(options().transformer.from('old plain draft')).toBe(
      'old plain draft',
    );
  });
});
