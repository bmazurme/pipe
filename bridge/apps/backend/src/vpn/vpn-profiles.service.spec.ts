import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';

import {
  MAX_PROFILE_LINKS,
  PROFILE_PATH,
  toSubscription,
  TOKEN_PREFIX,
  VpnProfilesService,
} from './vpn-profiles.service';

const link = (host: string) =>
  `vless://11111111-2222-3333-4444-555555555555@${host}:443?type=tcp&security=reality&encryption=none&fp=firefox&sni=example.com&sid=&pbk=PUBKEY#remark`;

function build(rows: Array<Record<string, unknown>> = []) {
  const store = rows.map((row) => ({ ...row }));
  const tokens = {
    create: jest.fn((partial) => ({ ...partial })),
    save: jest.fn(async (entity) =>
      Object.assign(entity, {
        id: entity.id ?? 7,
        createdAt: new Date('2026-11-11T12:00:00Z'),
      }),
    ),
    find: jest.fn(async () => store),
    findOneBy: jest.fn(
      async (where: Record<string, unknown>) =>
        store.find((row) =>
          where.id !== undefined
            ? row.id === where.id
            : row.tokenHash === where.tokenHash && row.revokedAt == null,
        ) ?? null,
    ),
    update: jest.fn(async () => undefined),
  };
  const connections = {
    findAll: jest.fn(
      async () => [] as Array<{ id: number; name: string; isActive: boolean }>,
    ),
  };
  const links = {
    resolveMany: jest.fn<Promise<string[]>, [number]>(async () => []),
  };
  const service = new VpnProfilesService(
    tokens as never,
    connections as never,
    links as never,
  );

  return { service, tokens, connections, links, store };
}

describe('VpnProfilesService: tokens', () => {
  it('makes a token that is shown once, keeps only its hash, and names the path to fetch the profile', async () => {
    const { service, tokens } = build();

    const created = await service.create('  iPhone  ', 'phone');

    expect(created.token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(created.token.length).toBeGreaterThan(30);
    expect(created.path).toBe(`${PROFILE_PATH}/${created.token}`);
    expect(created).toMatchObject({
      id: 7,
      label: 'iPhone',
      audience: 'phone',
      tokenPrefix: created.token.slice(0, 8),
      lastUsedAt: null,
      revokedAt: null,
    });
    const saved = tokens.create.mock.calls[0][0];

    expect(saved.tokenHash).toBe(
      createHash('sha256').update(created.token).digest('hex'),
    );
    expect(JSON.stringify(saved)).not.toContain(created.token);
  });

  it('makes a different token every time', async () => {
    const { service } = build();

    const [a, b] = [
      await service.create('a', 'phone'),
      await service.create('b', 'laptop'),
    ];

    expect(a.token).not.toBe(b.token);
  });

  it('lists the tokens without ever returning a token or its hash', async () => {
    const { service } = build([
      {
        id: 1,
        label: 'Mac',
        audience: 'laptop',
        tokenHash: 'h',
        tokenPrefix: 'brp_ab12',
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);

    const list = await service.list();

    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain('"h"');
    expect(Object.keys(list[0]).sort()).toEqual([
      'audience',
      'createdAt',
      'id',
      'label',
      'lastUsedAt',
      'revokedAt',
      'tokenPrefix',
    ]);
  });

  it('revokes a token once, and says so for one that does not exist', async () => {
    const { service, store, tokens } = build([
      { id: 1, label: 'Mac', revokedAt: null },
    ]);

    await service.revoke(1);
    const first = store[0].revokedAt as Date;
    await service.revoke(1);

    expect(first).toBeInstanceOf(Date);
    expect(store[0].revokedAt).toBe(first);
    expect(tokens.save).toHaveBeenCalledTimes(1);
    await expect(service.revoke(99)).rejects.toThrow(NotFoundException);
  });

  describe('authenticate', () => {
    const tokenRow = (token: string, over: object = {}) => ({
      id: 3,
      label: 'iPhone',
      audience: 'phone',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      lastUsedAt: null,
      revokedAt: null,
      ...over,
    });

    it('knows a token by its hash and notes when it was used', async () => {
      const { service, tokens } = build([tokenRow('brp_secret')]);
      const now = new Date('2026-11-11T13:00:00Z');

      await expect(
        service.authenticate('brp_secret', now),
      ).resolves.toMatchObject({ id: 3 });
      expect(tokens.update).toHaveBeenCalledWith(
        { id: 3 },
        { lastUsedAt: now },
      );
    });

    it('does not write "last used" again within five minutes', async () => {
      const { service, tokens } = build([
        tokenRow('brp_secret', {
          lastUsedAt: new Date('2026-11-11T12:58:00Z'),
        }),
      ]);

      await service.authenticate(
        'brp_secret',
        new Date('2026-11-11T13:00:00Z'),
      );

      expect(tokens.update).not.toHaveBeenCalled();
    });

    it.each([
      ['an unknown token', 'brp_other'],
      ['something that is not a token', 'hello'],
      ['an overlong string', `brp_${'a'.repeat(300)}`],
    ])('refuses %s', async (_label, token) => {
      const { service } = build([tokenRow('brp_secret')]);

      await expect(service.authenticate(token)).resolves.toBeNull();
    });

    it('refuses a revoked token', async () => {
      const { service } = build([
        tokenRow('brp_secret', { revokedAt: new Date() }),
      ]);

      await expect(service.authenticate('brp_secret')).resolves.toBeNull();
    });
  });
});

describe('VpnProfilesService.build', () => {
  const conn = (id: number, name: string, isActive = false) => ({
    id,
    name,
    isActive,
  });

  it('puts the active connection first and names every link after its connection', async () => {
    const { service, connections, links } = build();
    connections.findAll.mockResolvedValue([
      conn(1, 'backup'),
      conn(2, 'main', true),
    ]);
    links.resolveMany.mockImplementation(async (id) =>
      id === 2 ? [link('203.0.113.2')] : [link('203.0.113.1')],
    );

    const { links: out, failed } = await service.build();

    expect(failed).toEqual([]);
    expect(out.map((l) => l.split('#')[1])).toEqual(['main', 'backup']);
    expect(out[0]).toContain('203.0.113.2');
  });

  it('numbers the links of a connection that has a pool', async () => {
    const { service, connections, links } = build();
    connections.findAll.mockResolvedValue([conn(1, 'PaperVPN', true)]);
    links.resolveMany.mockResolvedValue([
      link('203.0.113.1'),
      link('203.0.113.2'),
    ]);

    const { links: out } = await service.build();

    expect(out.map((l) => decodeURIComponent(l.split('#')[1]))).toEqual([
      'PaperVPN-1',
      'PaperVPN-2',
    ]);
  });

  it('serves the rest, and says which connection failed, when one cannot be read now', async () => {
    const { service, connections, links } = build();
    connections.findAll.mockResolvedValue([
      conn(1, 'down', true),
      conn(2, 'up'),
    ]);
    links.resolveMany.mockImplementation(async (id) => {
      if (id === 1) throw new Error('panel unreachable');

      return [link('203.0.113.2')];
    });

    const result = await service.build();

    expect(result.failed).toEqual(['down']);
    expect(result.links).toHaveLength(1);
  });

  it('leaves out a link that two connections share, and caps the profile', async () => {
    const { service, connections, links } = build();
    connections.findAll.mockResolvedValue([
      conn(1, 'same', true),
      conn(2, 'same'),
    ]);
    links.resolveMany.mockResolvedValue([link('203.0.113.1')]);
    expect((await service.build()).links).toHaveLength(1);

    connections.findAll.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => conn(i + 1, `c${i}`)),
    );
    links.resolveMany.mockImplementation(async (id) => [
      link(`198.51.100.${id}`),
    ]);
    expect((await service.build()).links).toHaveLength(MAX_PROFILE_LINKS);
  });

  it('is empty when there are no connections', async () => {
    const { service } = build();

    await expect(service.build()).resolves.toEqual({ links: [], failed: [] });
  });
});

describe('toSubscription', () => {
  it('is the links one per line, base64-encoded — what the clients import', () => {
    const encoded = toSubscription(['vless://a#x', 'vless://b#y']);

    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe(
      'vless://a#x\nvless://b#y',
    );
  });
});

describe('VpnProfilesService: rename', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 3,
    label: 'iPhone',
    audience: 'phone',
    tokenHash: 'hash-stays',
    tokenPrefix: 'brp_ab12',
    createdAt: new Date('2026-11-11T10:00:00Z'),
    lastUsedAt: null,
    revokedAt: null,
    ...over,
  });

  it('changes the name and nothing else — the token, its hash and the link stay', async () => {
    const { service, tokens, store } = build([row()]);

    const renamed = await service.rename(3, '  Телефон Богдана  ');

    expect(renamed.label).toBe('Телефон Богдана');
    expect(tokens.save).toHaveBeenCalledTimes(1);
    expect(store[0]).toMatchObject({
      tokenHash: 'hash-stays',
      tokenPrefix: 'brp_ab12',
      audience: 'phone',
      revokedAt: null,
    });
    expect(Object.keys(renamed).sort()).toEqual([
      'audience',
      'createdAt',
      'id',
      'label',
      'lastUsedAt',
      'revokedAt',
      'tokenPrefix',
    ]);
  });

  it('writes nothing when the name is the one it already has', async () => {
    const { service, tokens } = build([row()]);

    await expect(service.rename(3, ' iPhone ')).resolves.toMatchObject({
      label: 'iPhone',
    });
    expect(tokens.save).not.toHaveBeenCalled();
  });

  it('refuses an empty name, before it looks anything up', async () => {
    const { service, tokens } = build([row()]);

    await expect(service.rename(3, '   ')).rejects.toThrow(BadRequestException);
    expect(tokens.findOneBy).not.toHaveBeenCalled();
    expect(tokens.save).not.toHaveBeenCalled();
  });

  it('is a 404 for a device that is not there', async () => {
    const { service } = build([row()]);

    await expect(service.rename(99, 'x')).rejects.toThrow(NotFoundException);
  });

  it('renames a revoked device too: it is still in the list', async () => {
    const { service, store } = build([
      row({ revokedAt: new Date('2026-11-12T00:00:00Z') }),
    ]);

    await expect(service.rename(3, 'Старый телефон')).resolves.toMatchObject({
      label: 'Старый телефон',
    });
    expect(store[0].label).toBe('Старый телефон');
  });
});
