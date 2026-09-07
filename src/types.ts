export interface ProjectConfig {
  name: string;
  path: string;
  dictionary: string;
  include?: string[];
  exclude?: string[];
}

export interface SyncConfig {
  bridge: {
    apiUrl: string;
  };
  projects: ProjectConfig[];
}

export interface Credentials {
  refreshToken: string;
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
