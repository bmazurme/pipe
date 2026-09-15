export interface ProjectConfig {
  name: string;
  path: string;
  dictionary: string;
  include?: string[];
  exclude?: string[];
  // Issue-mode only (push-issue/pull-issue) — paths to a PEM key pair for the
  // hybrid RSA-OAEP+AES-256-GCM envelope compatible with reports' Subscription
  // module (see src/encryption.ts). Resolved the same way as `dictionary`.
  publicKeyPath?: string;
  privateKeyPath?: string;
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
