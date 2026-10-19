export type EnsureProtocolResult = 'built' | 'ready' | 'missing';

export function ensureProtocol(options: {
  reportsRoot: string;
  exists?: (path: string) => boolean;
  run?: (command: string, args: string[], cwd: string) => void;
  log?: (message: string) => void;
}): EnsureProtocolResult;
