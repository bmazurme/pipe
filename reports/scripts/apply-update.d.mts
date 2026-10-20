export function isPreserved(relPath: string): boolean;
export function isSafeReleasePath(relPath: string): boolean;

export interface ApplyUpdateSummary {
  releaseId: string;
  changed: string[];
  created: string[];
  removed: string[];
  keptAsIs: string[];
  manifestsChanged: boolean;
}

export function applyUpdate(options: {
  installRoot: string;
  stagingDir: string;
  run?: (command: string, args: string[], cwd: string) => void;
  log?: (message: string) => void;
  setStatus?: (phase: string, message: string) => void;
  restart?: () => void;
}): ApplyUpdateSummary;
