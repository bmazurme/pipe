import { beforeEach, describe, expect, it, vi } from 'vitest';

const compileSpy = vi.hoisted(() => vi.fn());
const actualCompile = vi.hoisted(() => ({ fn: undefined as unknown as (d: Map<string, string>) => unknown }));

vi.mock('@pipe/protocol/dictionary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pipe/protocol/dictionary')>();
  actualCompile.fn = actual.compileDictionary;
  return { ...actual, compileDictionary: compileSpy };
});

import { buildProjectZip } from './projectZip';

function fileAt(path: string, content: string): File {
  const file = new File([content], path.split('/').pop() ?? path);
  Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true });
  return file;
}

describe('buildProjectZip dictionary compilation', () => {
  beforeEach(() => {
    compileSpy.mockReset();
    compileSpy.mockImplementation((d: Map<string, string>) => actualCompile.fn(d));
  });

  it('compiles the dictionary once for the whole upload', async () => {
    const files = [fileAt('p/a.ts', 'Acme'), fileAt('p/b.ts', 'Acme Acme'), fileAt('p/c.ts', 'none')];
    const { replacedCount } = await buildProjectZip(files, new Map([['Acme', 'Zzzz']]), () => {});
    expect(replacedCount).toBe(3);
    expect(compileSpy).toHaveBeenCalledTimes(1);
  });
});
