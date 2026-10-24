import { githubDispatcher } from './github-dispatcher';

describe('githubDispatcher', () => {
  const saved = process.env.GITHUB_PROXY_URL;

  afterEach(() => {
    if (saved === undefined) delete process.env.GITHUB_PROXY_URL;
    else process.env.GITHUB_PROXY_URL = saved;
  });

  it('is nothing — a direct connection — unless GITHUB_PROXY_URL is set', () => {
    delete process.env.GITHUB_PROXY_URL;
    expect(githubDispatcher()).toBeUndefined();

    process.env.GITHUB_PROXY_URL = '   ';
    expect(githubDispatcher()).toBeUndefined();
  });

  it('is one proxy agent per URL, reused for the next call, replaced when the URL changes', () => {
    process.env.GITHUB_PROXY_URL = 'http://vpn-client:1080';
    const first = githubDispatcher();

    expect(first).toBeDefined();
    expect(githubDispatcher()).toBe(first);

    process.env.GITHUB_PROXY_URL = 'http://other-proxy:3128';
    expect(githubDispatcher()).not.toBe(first);
  });
});
