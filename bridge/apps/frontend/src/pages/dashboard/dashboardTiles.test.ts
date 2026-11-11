import { describe, expect, it } from 'vitest';

import { DASHBOARD_TILES, tileLevels, tileOfAttention } from './dashboardTiles';

describe('tileOfAttention', () => {
  it('leads every kind of attention item to its tile', () => {
    expect(tileOfAttention('vpn')).toBe('tile-vpn');
    expect(tileOfAttention('vpn-list')).toBe('tile-vpn');
    expect(tileOfAttention('nodes')).toBe('tile-nodes');
    expect(tileOfAttention('backup')).toBe('tile-backups');
    expect(tileOfAttention('release')).toBe('tile-releases');
    expect(tileOfAttention('cloud:yc-vm')).toBe('tile-cloud');
    expect(tileOfAttention('channels')).toBe('tile-channels');
    expect(tileOfAttention('board:ubuntu-blue')).toBe('tile-boards');
    expect(tileOfAttention('nas:MyCloudEX2Ultra')).toBe('tile-nas');
    expect(tileOfAttention('ups:ups')).toBe('tile-ups');
    expect(tileOfAttention('router:asus')).toBe('tile-router');
  });

  it('knows nothing of an id it was not given', () => {
    expect(tileOfAttention('mystery')).toBeNull();
  });

  it('only leads to tiles the bar lists', () => {
    const ids = new Set(DASHBOARD_TILES.map((tile) => tile.id));

    for (const id of ['vpn', 'nodes', 'backup', 'release', 'cloud:x', 'channels', 'board:x', 'nas:x', 'ups:x', 'router:x']) {
      expect(ids.has(tileOfAttention(id) as string)).toBe(true);
    }
  });
});

describe('tileLevels', () => {
  it('takes the worst level of a tile', () => {
    expect(
      tileLevels([
        { id: 'board:a', level: 'warn', text: '' },
        { id: 'board:b', level: 'bad', text: '' },
        { id: 'board:c', level: 'warn', text: '' },
        { id: 'nas:n', level: 'warn', text: '' },
      ]),
    ).toEqual({ 'tile-boards': 'bad', 'tile-nas': 'warn' });
  });

  it('is empty when nothing is wrong', () => {
    expect(tileLevels([])).toEqual({});
  });
});
