export type RemoteJobStatus = 'queued' | 'claimed' | 'running' | 'succeeded' | 'failed';

export interface RemoteJob {
  id: number;
  sourceFileId: number;
  resultFileId: number | null;
  model: 'sonnet' | 'opus' | 'gpt' | 'deepseek' | 'qwen';
  status: RemoteJobStatus;
}

// A worker instance authenticates with a single personal API key — the same
// "unified machine auth" mechanism sync/reports already use — so, unlike
// sync's own BridgeClient, there's no browser-session refresh-token dance
// to implement here at all.
export class WorkerBridgeClient {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
  ) {}

  private authHeaders(json = false): Record<string, string> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }

  // Returns null when nothing is queued right now — bridge sends an empty
  // body for that case (204 is the current behavior; an older deployment
  // may still send 201 with no body), never a 200 with JSON "null".
  // response.json() throws on an empty body ("Unexpected end of JSON
  // input"), so this checks the raw text first rather than assuming a
  // specific status code — robust either way, and to bridge deployments
  // that haven't picked up the 204 fix yet.
  async claim(workerName: string): Promise<RemoteJob | null> {
    const response = await fetch(`${this.apiUrl}/api/v1/worker/jobs/claim`, {
      method: 'POST',
      headers: this.authHeaders(true),
      body: JSON.stringify({ workerName }),
    });

    if (!response.ok) {
      throw new Error(`Claim failed (${response.status}): ${await response.text()}`);
    }

    const text = await response.text();
    return text ? (JSON.parse(text) as RemoteJob | null) : null;
  }

  async downloadParcel(jobId: number): Promise<Buffer> {
    const response = await fetch(`${this.apiUrl}/api/v1/worker/jobs/${jobId}/parcel`, {
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Downloading parcel for job ${jobId} failed (${response.status})`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async updateStatus(
    jobId: number,
    status: 'running' | 'succeeded' | 'failed',
    errorMessage?: string,
  ): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/v1/worker/jobs/${jobId}/status`, {
      method: 'POST',
      headers: this.authHeaders(true),
      body: JSON.stringify({ status, errorMessage }),
    });

    if (!response.ok) {
      throw new Error(`Updating status for job ${jobId} failed (${response.status})`);
    }
  }

  // Best-effort by design: a log line that fails to reach bridge shouldn't
  // abort the job itself, only be swallowed with a local console warning by
  // the caller (see index.ts) — the job's real outcome is its final status.
  async appendLog(jobId: number, chunk: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/v1/worker/jobs/${jobId}/logs`, {
      method: 'POST',
      headers: this.authHeaders(true),
      body: JSON.stringify({ chunk }),
    });

    if (!response.ok) {
      throw new Error(`Appending log for job ${jobId} failed (${response.status})`);
    }
  }

  async uploadResult(jobId: number, filename: string, buffer: Buffer): Promise<void> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)]), filename);

    const response = await fetch(`${this.apiUrl}/api/v1/worker/jobs/${jobId}/result`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
    });

    if (!response.ok) {
      throw new Error(`Uploading result for job ${jobId} failed (${response.status}): ${await response.text()}`);
    }
  }
}
