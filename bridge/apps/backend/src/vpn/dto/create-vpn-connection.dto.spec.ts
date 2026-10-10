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
      plainToInstance(UpdateVpnConnectionDto, { panelUrl: 'file:///etc/passwd' }),
      { skipMissingProperties: true },
    );
    expect(errors.map((e) => e.property)).toContain('panelUrl');
  });
});
