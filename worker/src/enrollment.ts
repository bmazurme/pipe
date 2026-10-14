import { hostname } from 'node:os';

import { BridgeHttpError, bridgeFetch } from './bridgeHttp.js';
import type { StoredCredentials } from './credentials.js';

export class EnrollmentRejectedError extends Error {
  constructor() {
    super('The enrollment code was rejected (used already, expired, or mistyped) — create a new one in the Worker page');
    this.name = 'EnrollmentRejectedError';
  }
}

// Exchanges the one-time code from the Worker page for this worker's own key. The code is single-use and expires in
// 30 minutes; the key is returned once, here, and is never shown anywhere else.
export async function enrollWorker(
  bridgeApiUrl: string,
  code: string,
  version: string,
  host: string = hostname(),
): Promise<StoredCredentials> {
  try {
    const response = await bridgeFetch(
      `${bridgeApiUrl}/api/v1/workers/enroll`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), hostname: host, version }),
      },
      { expectOk: 'Enrollment', includeBody: true },
    );
    const body = (await response.json()) as { workerId: number; name: string; key: string };

    return {
      bridgeApiUrl,
      workerId: body.workerId,
      name: body.name,
      key: body.key,
      enrolledAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof BridgeHttpError && error.status === 401) {
      throw new EnrollmentRejectedError();
    }

    throw error;
  }
}
