import { describe, expect, it } from 'vitest';

import { scanFileForLeaks, scanFilesForLeaks } from './scanFileForLeaks';

function textFile(name: string, content: string): File {
  return new File([content], name);
}

describe('scanFileForLeaks', () => {
  it('returns null for a binary (non-text) file, regardless of content', async () => {
    const result = await scanFileForLeaks(textFile('logo.png', 'dev@example.com'), []);
    expect(result).toBeNull();
  });

  it('returns null for clean text with no dictionary configured', async () => {
    const result = await scanFileForLeaks(textFile('a.ts', 'export const x = 1;'), []);
    expect(result).toBeNull();
  });

  it('flags a real-looking pattern (email) even with no dictionary entries', async () => {
    const result = await scanFileForLeaks(
      textFile('notes.txt', 'contact: oncall@acme-corp.example'),
      [],
    );

    expect(result).not.toBeNull();
    expect(result?.dictionaryHits).toBe(0);
    expect(result?.patternFindings.some((f) => f.kind === 'email')).toBe(true);
  });

  it('flags a dictionary key (real secret value) left unsubstituted', async () => {
    const entries = [
      { id: 1, key: 'sk_live_9fJ3kLp0Qz7Xw2Bv8Yc1Nm4RtGh6Ae5D', value: '{{API_KEY}}', createdAt: '' },
    ];
    const result = await scanFileForLeaks(
      textFile('config.ts', 'const key = "sk_live_9fJ3kLp0Qz7Xw2Bv8Yc1Nm4RtGh6Ae5D";'),
      entries,
    );

    expect(result).not.toBeNull();
    expect(result?.dictionaryHits).toBe(1);
  });

  it('finds nothing once the dictionary value has actually been substituted', async () => {
    const entries = [
      { id: 1, key: 'sk_live_9fJ3kLp0Qz7Xw2Bv8Yc1Nm4RtGh6Ae5D', value: '{{API_KEY}}', createdAt: '' },
    ];
    const result = await scanFileForLeaks(
      textFile('config.ts', 'const key = "{{API_KEY}}";'),
      entries,
    );

    expect(result).toBeNull();
  });
});

describe('scanFilesForLeaks', () => {
  it('only returns entries for files that actually have findings', async () => {
    const files = [
      textFile('clean.ts', 'export const ok = true;'),
      textFile('leaky.txt', 'ping me at dev@example-corp.internal'),
    ];

    const results = await scanFilesForLeaks(files, []);

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('leaky.txt');
  });
});
