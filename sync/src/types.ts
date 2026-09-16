export interface ProjectConfig {
  name: string;
  path: string;
  // Omit for a project that never de-/anonymizes (e.g. one only ever used
  // through agent-runner, which is deliberately dictionary-free — see
  // README "agent-runner"). push/pull/push-issue/pull-issue then pass
  // content through unchanged instead of failing to find a dictionary file.
  dictionary?: string;
  include?: string[];
  exclude?: string[];
  // Issue-mode only (push-issue/pull-issue) — paths to a PEM key pair for the
  // hybrid RSA-OAEP+AES-256-GCM envelope compatible with reports' Subscription
  // module (see src/encryption.ts). Resolved the same way as `dictionary`.
  publicKeyPath?: string;
  privateKeyPath?: string;
  // agent-runner only — restricts which incoming parcels this project claims
  // to those addressed to this GitLab project id (parsed from the parcel
  // filename `${gitlabProjectId}-${iid}.subscription.zip`). Omit to claim
  // any project id (fine for a single-project setup).
  gitlabProjectId?: string;
  // agent-runner only — base branch new task worktrees are created from.
  // Defaults to "main".
  baseBranch?: string;
}

export interface SyncConfig {
  bridge: {
    apiUrl: string;
  };
  // Issue-mode only — base URL of the GitLab API (e.g. "https://gitlab.example.com/api/v4").
  gitlab?: {
    apiUrl: string;
  };
  projects: ProjectConfig[];
}

export interface Credentials {
  refreshToken: string;
  // Issue-mode only — GitLab personal access token, set via "login-gitlab".
  gitlabToken?: string;
}

export interface SyncState {
  [projectName: string]: {
    lastHash: string;
  };
}

export interface StoredFileResponse {
  id: number;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface SyncManifest {
  project: string;
  machine: string;
  createdAt: string;
  contentHash: string;
}

// agent-runner only — remembers the content hash of the last result *it*
// pushed for each GitLab issue, so its own push-back isn't mistaken for a
// fresh incoming parcel on the next poll (agent-runner both consumes and
// produces parcels under the same `${projectId}-${iid}.subscription.zip`
// name, since that name is reports' contract and can't change per side).
export interface AgentRunnerState {
  [issueKey: string]: {
    lastOwnOutputHash: string;
  };
}
