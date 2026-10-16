import { limitProbeWanted, REQUEST_VALID_MS } from './limit-probe';

const NOW = new Date('2026-10-16T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('limitProbeWanted', () => {
  it('is not due when nothing was asked for and no interval is set', () => {
    expect(
      limitProbeWanted(
        { limitsRefreshMin: 0, limitsRefreshRequestedAt: null },
        NOW,
      ),
    ).toBe(false);
  });

  it('is due while a request from the owner is fresh, and not after it went stale', () => {
    expect(
      limitProbeWanted(
        { limitsRefreshMin: 0, limitsRefreshRequestedAt: ago(60_000) },
        NOW,
      ),
    ).toBe(true);
    expect(
      limitProbeWanted(
        {
          limitsRefreshMin: 0,
          limitsRefreshRequestedAt: ago(REQUEST_VALID_MS + 1000),
        },
        NOW,
      ),
    ).toBe(false);
  });

  it('is always due (the worker paces itself) when an interval is set', () => {
    expect(
      limitProbeWanted(
        { limitsRefreshMin: 30, limitsRefreshRequestedAt: null },
        NOW,
      ),
    ).toBe(true);
  });
});
