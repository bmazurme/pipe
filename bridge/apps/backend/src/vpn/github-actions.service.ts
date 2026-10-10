import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { encryptSecretForGitHub } from './github-secrets.util';
import { OUTBOUND_FETCH_TIMEOUT_MS, isTimeoutError } from './outbound';

@Injectable()
export class GithubActionsService {
  constructor(private readonly configService: ConfigService) {}

  private required(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new InternalServerErrorException(
        `${key} is not configured on bridge's backend`,
      );
    }
    return value;
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `https://api.github.com/repos/${this.required('GITHUB_REPO')}${path}`;
    const headers = {
      Authorization: `Bearer ${this.required('GITHUB_TOKEN')}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {}),
    };

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new BadGatewayException(
          `GitHub API request failed (${response.status}): ${await response.text()}`,
        );
      }

      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new BadGatewayException(
          `GitHub API request timed out after ${OUTBOUND_FETCH_TIMEOUT_MS}ms (${init?.method ?? 'GET'} ${path})`,
        );
      }
      throw error;
    }
  }

  // GitHub Actions secrets are write-only (sealed-box encrypted client-side,
  // no corresponding read endpoint) — see github-secrets.util.ts.
  async setSecret(name: string, value: string): Promise<void> {
    const { key, key_id: keyId } = await this.request<{
      key: string;
      key_id: string;
    }>('/actions/secrets/public-key');
    const encryptedValue = await encryptSecretForGitHub(key, value);

    await this.request(`/actions/secrets/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted_value: encryptedValue, key_id: keyId }),
    });
  }

  async dispatchWorkflow(workflowFile: string): Promise<void> {
    await this.request(`/actions/workflows/${workflowFile}/dispatches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    });
  }

  async triggerDeploy(): Promise<void> {
    const workflowFile =
      this.configService.get<string>('GITHUB_DEPLOY_WORKFLOW') ??
      'deploy-bridge.yml';
    await this.dispatchWorkflow(workflowFile);
  }
}
