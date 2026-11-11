import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateVpnConnectionDto } from './create-vpn-connection.dto';
import { UpdateVpnConnectionDto } from './update-vpn-connection.dto';

const valid = {
  name: 'main',
  panelUrl: 'https://vpn.example.com:2053/secret-path',
  panelApiToken: 'token',
  serverAddress: '203.0.113.7',
};

const errorsFor = async (overrides: Record<string, unknown>) =>
  (
    await validate(
      plainToInstance(CreateVpnConnectionDto, { ...valid, ...overrides }),
    )
  ).map((e) => e.property);

describe('CreateVpnConnectionDto validation', () => {
  it('accepts a normal https panelUrl and IPv4 serverAddress', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it('accepts http host:port and hostname serverAddress', async () => {
    expect(
      await errorsFor({
        panelUrl: 'http://panel:2053/x',
        serverAddress: 'vpn.example.com',
      }),
    ).toEqual([]);
  });

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'vpn.example.com/path',
    'ftp://vpn.example.com',
    '',
  ])('rejects panelUrl %p', async (panelUrl) => {
    expect(await errorsFor({ panelUrl })).toContain('panelUrl');
  });

  it('rejects an over-long panelUrl and panelApiToken', async () => {
    expect(
      await errorsFor({ panelUrl: `https://example.com/${'a'.repeat(300)}` }),
    ).toContain('panelUrl');
    expect(await errorsFor({ panelApiToken: 'a'.repeat(2049) })).toContain(
      'panelApiToken',
    );
  });

  it.each(['a/b', 'a?b', 'a#b', 'a b', 'host\n', 'a@b'])(
    'rejects serverAddress %p',
    async (serverAddress) => {
      expect(await errorsFor({ serverAddress })).toContain('serverAddress');
    },
  );

  it('applies the same rules to the update DTO', async () => {
    const errors = await validate(
      plainToInstance(UpdateVpnConnectionDto, {
        panelUrl: 'file:///etc/passwd',
      }),
      { skipMissingProperties: true },
    );
    expect(errors.map((e) => e.property)).toContain('panelUrl');
  });
});

const errorsOf = async (cls: new () => object, body: unknown) =>
  (await validate(plainToInstance(cls, body), { whitelist: true })).map(
    (e) => e.property,
  );

const PANEL = {
  name: 'NL',
  panelUrl: 'http://1.2.3.4:2053/abc',
  panelApiToken: 't',
  serverAddress: '1.2.3.4',
};

describe('CreateVpnConnectionDto', () => {
  it('takes a panel connection as before', async () => {
    expect(await errorsOf(CreateVpnConnectionDto, PANEL)).toEqual([]);
  });

  it('takes a subscription link with nothing else but a name', async () => {
    expect(
      await errorsOf(CreateVpnConnectionDto, {
        name: 'PaperVPN',
        subscriptionUrl: 'https://api.provider.example/sub/abc#PaperVPN',
      }),
    ).toEqual([]);
  });

  it('still asks for every panel field when there is no subscription link', async () => {
    expect(
      (await errorsOf(CreateVpnConnectionDto, { name: 'NL' })).sort(),
    ).toEqual(['panelApiToken', 'panelUrl', 'serverAddress']);
  });

  it.each([
    ['http', 'http://api.provider.example/sub'],
    ['no host with a dot', 'https://localhost/sub'],
    ['not an address', 'vless://u@h:443'],
  ])(
    'refuses a subscription link that is %s',
    async (_label, subscriptionUrl) => {
      expect(
        await errorsOf(CreateVpnConnectionDto, { name: 'x', subscriptionUrl }),
      ).toContain('subscriptionUrl');
    },
  );

  it('refuses an overlong link and a missing name', async () => {
    const long = `https://p.example/${'a'.repeat(2100)}`;

    expect(
      await errorsOf(CreateVpnConnectionDto, {
        name: 'x',
        subscriptionUrl: long,
      }),
    ).toContain('subscriptionUrl');
    expect(
      await errorsOf(CreateVpnConnectionDto, {
        subscriptionUrl: 'https://p.example/sub',
      }),
    ).toContain('name');
  });
});

describe('UpdateVpnConnectionDto', () => {
  it('accepts a single field, including a new subscription link', async () => {
    expect(await errorsOf(UpdateVpnConnectionDto, { name: 'renamed' })).toEqual(
      [],
    );
    expect(
      await errorsOf(UpdateVpnConnectionDto, {
        subscriptionUrl: 'https://p.example/sub/new',
      }),
    ).toEqual([]);
    expect(await errorsOf(UpdateVpnConnectionDto, {})).toEqual([]);
  });

  it('still validates what it is given', async () => {
    expect(
      await errorsOf(UpdateVpnConnectionDto, {
        subscriptionUrl: 'http://p.example/sub',
      }),
    ).toContain('subscriptionUrl');
  });
});
