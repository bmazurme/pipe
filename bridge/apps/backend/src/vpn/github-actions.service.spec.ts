import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { GithubActionsService } from './github-actions.service';

const ENV: Record<string, string> = {
  GITHUB_TOKEN: 'gh-token',
  GITHUB_REPO: 'acme/pipe',
};

function githubService(env: Record<string, string> = ENV) {
  return new GithubActionsService({
    get: (key: string) => env[key],
  } as unknown as ConfigService);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GithubActionsService', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('setSecret + triggerDeploy', () => {
    it('encrypts and pushes the named secret, then dispatches the deploy workflow', async () => {
      const calls: { url: string; init?: RequestInit }[] = [];

      globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });

        if (url.endsWith('/actions/secrets/public-key')) {
          return jsonResponse({
            key: Buffer.alloc(32, 7).toString('base64'),
            key_id: 'key-id-1',
          });
        }
        if (
          url.endsWith('/actions/secrets/VPN_CLIENT_CONFIG') ||
          url.endsWith('/actions/workflows/deploy-bridge.yml/dispatches')
        ) {
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }) as typeof fetch;

      const service = githubService();
      await service.setSecret('VPN_CLIENT_CONFIG', '{}');
      await service.triggerDeploy();

      const secretPut = calls.find((c) =>
        c.url.endsWith('/actions/secrets/VPN_CLIENT_CONFIG'),
      );
      expect(secretPut!.url).toBe(
        'https://api.github.com/repos/acme/pipe/actions/secrets/VPN_CLIENT_CONFIG',
      );
      const body = JSON.parse(secretPut!.init!.body as string);
      expect(body.key_id).toBe('key-id-1');
      expect(typeof body.encrypted_value).toBe('string');

      const dispatch = calls.find((c) => c.url.endsWith('/dispatches'));
      expect(JSON.parse(dispatch!.init!.body as string)).toEqual({
        ref: 'main',
      });
    });

    it('uses GITHUB_DEPLOY_WORKFLOW when configured', async () => {
      const fetchMock = jest.fn(
        async () => new Response(null, { status: 204 }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await githubService({
        ...ENV,
        GITHUB_DEPLOY_WORKFLOW: 'custom.yml',
      }).triggerDeploy();

      expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(
        'https://api.github.com/repos/acme/pipe/actions/workflows/custom.yml/dispatches',
      );
    });
  });

  describe('dispatchWorkflow', () => {
    it('dispatches the given workflow file on main', async () => {
      const fetchMock = jest.fn(
        async () => new Response(null, { status: 204 }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await githubService().dispatchWorkflow('provision-vpn-server.yml');

      expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(
        'https://api.github.com/repos/acme/pipe/actions/workflows/provision-vpn-server.yml/dispatches',
      );
    });
  });

  describe('request', () => {
    it('throws when GITHUB_TOKEN is not configured', async () => {
      await expect(
        githubService({ GITHUB_REPO: 'acme/pipe' }).request('/x'),
      ).rejects.toThrow('GITHUB_TOKEN is not configured');
    });

    it('maps a non-OK response to BadGatewayException', async () => {
      globalThis.fetch = jest.fn(
        async () => new Response('nope', { status: 500 }),
      ) as typeof fetch;

      await expect(githubService().request('/x')).rejects.toThrow(
        'GitHub API request failed (500): nope',
      );
    });

    it('passes an abort signal and maps a timeout to BadGatewayException', async () => {
      const fetchMock = jest.fn(async () => {
        const error = new Error('The operation was aborted due to timeout');
        error.name = 'TimeoutError';
        throw error;
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const promise = githubService().setSecret('OPENAI_API_KEY', 'sk-test');

      await expect(promise).rejects.toThrow(BadGatewayException);
      await expect(promise).rejects.toThrow('GitHub API request timed out');
      const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
