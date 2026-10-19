import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { ensureProtocol } from '../../../../scripts/ensure-protocol.mjs';

const reportsRoot = join(resolve('/work'), 'reports');
const protocolDir = join(resolve('/work'), 'packages', 'protocol');

const filesThat = (...present: string[]) => {
  const set = new Set(present.map((p) => join(protocolDir, p)));

  return (path: string) => set.has(path);
};

describe('ensureProtocol (the preinstall hook of reports)', () => {
  it('builds protocol — install, then build, in its folder — when its dist/ is missing', () => {
    const run = vi.fn();
    const log = vi.fn();

    const result = ensureProtocol({ reportsRoot, exists: filesThat('package.json'), run, log });

    expect(result).toBe('built');
    expect(run.mock.calls).toEqual([
      ['npm', ['install'], protocolDir],
      ['npm', ['run', 'build'], protocolDir],
    ]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('собираю packages/protocol'));
  });

  it("does nothing when protocol is already built (Docker image, CI, a developer's tree)", () => {
    const run = vi.fn();

    expect(ensureProtocol({ reportsRoot, exists: filesThat('package.json', join('dist', 'index.js')), run })).toBe(
      'ready',
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('says plainly what is wrong when packages/protocol is not next to reports/ (only one folder was unzipped)', () => {
    const run = vi.fn();
    const log = vi.fn();

    expect(ensureProtocol({ reportsRoot, exists: () => false, run, log })).toBe('missing');
    expect(run).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('распакуйте архив целиком'));
  });

  it('lets a failing build stop the install instead of swallowing it', () => {
    const run = vi.fn(() => {
      throw new Error('npm run build failed');
    });

    expect(() => ensureProtocol({ reportsRoot, exists: filesThat('package.json'), run, log: vi.fn() })).toThrow(
      'npm run build failed',
    );
  });
});
