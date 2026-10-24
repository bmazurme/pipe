import { BadRequestException } from '@nestjs/common';

import {
  githubProxyUrl,
  setGithubProxyChoice,
} from '../common/github-dispatcher';
import {
  DEFAULT_GITHUB_PROXY_URL,
  GithubConnectionService,
  normalizeProxyUrl,
} from './github-connection.service';
import { SystemSettings } from './entities/system-settings.entity';

function setup(row: Partial<SystemSettings> | null = null) {
  let stored = row as SystemSettings | null;
  const repo = {
    findOne: jest.fn(async () => stored),
    create: jest.fn(
      (value: Partial<SystemSettings>) => value as SystemSettings,
    ),
    save: jest.fn(async (value: SystemSettings) => {
      stored = value;

      return value;
    }),
  };
  const service = new GithubConnectionService(repo as never);

  return { service, repo };
}

describe('normalizeProxyUrl', () => {
  it('accepts an http(s) address and trims it', () => {
    expect(normalizeProxyUrl('  http://vpn-client:1080 ')).toBe(
      'http://vpn-client:1080',
    );
    expect(normalizeProxyUrl('https://proxy.example:8443')).toBe(
      'https://proxy.example:8443',
    );
  });

  it('refuses anything else', () => {
    for (const bad of [
      '',
      'vpn-client:1080',
      'ftp://x:1',
      'socks5://x:1080',
      'http://',
      'not a url',
    ])
      expect(() => normalizeProxyUrl(bad)).toThrow(BadRequestException);
  });
});

describe('GithubConnectionService', () => {
  const savedEnv = process.env.GITHUB_PROXY_URL;

  beforeEach(() => {
    delete process.env.GITHUB_PROXY_URL;
    setGithubProxyChoice(null);
  });
  afterAll(() => {
    if (savedEnv === undefined) delete process.env.GITHUB_PROXY_URL;
    else process.env.GITHUB_PROXY_URL = savedEnv;
    setGithubProxyChoice(null);
  });

  it('says nothing is chosen, and the proxy is off, when nothing is set anywhere', async () => {
    expect(await setup().service.state()).toEqual({
      enabled: false,
      url: DEFAULT_GITHUB_PROXY_URL,
      source: 'default',
    });
  });

  it('follows the environment while nothing was chosen here', async () => {
    process.env.GITHUB_PROXY_URL = 'http://env-proxy:3128';

    expect(await setup().service.state()).toEqual({
      enabled: true,
      url: 'http://env-proxy:3128',
      source: 'environment',
    });
  });

  it('what is chosen here wins over the environment — on or off', async () => {
    process.env.GITHUB_PROXY_URL = 'http://env-proxy:3128';
    const { service } = setup();

    await service.save(false);
    expect(await service.state()).toMatchObject({
      enabled: false,
      source: 'setting',
    });
    expect(githubProxyUrl()).toBeUndefined();

    await service.save(true, 'http://vpn-client:1080');
    expect(await service.state()).toEqual({
      enabled: true,
      url: 'http://vpn-client:1080',
      source: 'setting',
    });
    expect(githubProxyUrl()).toBe('http://vpn-client:1080');
  });

  it('keeps the proxy address when it is switched off, and refuses a bad one without saving', async () => {
    const { service, repo } = setup();

    await service.save(true, 'http://my-proxy:8080');
    await service.save(false);
    expect(await service.state()).toMatchObject({
      enabled: false,
      url: 'http://my-proxy:8080',
    });

    repo.save.mockClear();
    await expect(service.save(true, 'socks5://x:1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('applies the saved choice when the service starts, and returns to the environment when the row has none', async () => {
    const { service } = setup({
      id: 1,
      githubProxyEnabled: true,
      githubProxyUrl: 'http://saved:1',
    });

    await service.onModuleInit();
    expect(githubProxyUrl()).toBe('http://saved:1');

    const none = setup({
      id: 1,
      githubProxyEnabled: null,
      githubProxyUrl: null,
    });

    process.env.GITHUB_PROXY_URL = 'http://env:2';
    await none.service.reload();
    expect(githubProxyUrl()).toBe('http://env:2');
  });

  it('does not fail when the table is not there yet (before the migration)', async () => {
    const { service, repo } = setup();

    repo.findOne.mockRejectedValueOnce(
      new Error('relation "system_settings" does not exist'),
    );

    await expect(service.reload()).resolves.toBeUndefined();
  });
});
