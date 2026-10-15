import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TIMEOUT_MS = 10_000;
const DEFAULT_PROXY_URL = 'http://docker-proxy:2375';

// The Swarm cluster's 4 boards. A board that dropped out of `GET /nodes`
// entirely (not just unhealthy) still needs a row — otherwise losing a board
// completely would read as "everything's fine" instead of "one is missing".
const KNOWN_HOSTNAMES = [
  'ubuntu-white',
  'ubuntu-red',
  'ubuntu-green',
  'ubuntu-blue',
];

export type NodeState = 'ready' | 'down' | 'unknown';

export interface NodeStatus {
  hostname: string;
  label: string;
  state: NodeState;
  availability: string | null;
}

export interface NodesStatus {
  nodes: NodeStatus[];
  error?: string;
}

interface DockerNode {
  Description?: { Hostname?: string };
  Status?: { State?: string };
  Spec?: { Availability?: string };
}

function toLabel(hostname: string): string {
  return hostname.replace(/^ubuntu-/, '');
}

// Reads the Swarm cluster's node list through a docker-socket-proxy sidecar
// (see bridge/deploy/swarm/bridge-stack.yml's `docker-proxy` service) scoped
// to NODES=1 only — nothing about containers/services/exec is reachable
// through it, so this is read-only by construction, not just by convention.
@Injectable()
export class NodesService {
  private readonly logger = new Logger(NodesService.name);

  constructor(private readonly configService: ConfigService) {}

  async getStatus(): Promise<NodesStatus> {
    const url = this.proxyUrl();

    try {
      const response = await fetch(`${url}/nodes`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`docker-proxy ${response.status}`);
      }

      const live = (await response.json()) as DockerNode[];
      const byHostname = new Map(
        live.map((node) => [node.Description?.Hostname ?? '', node]),
      );

      const nodes: NodeStatus[] = KNOWN_HOSTNAMES.map((hostname) => {
        const node = byHostname.get(hostname);

        if (!node) {
          return {
            hostname,
            label: toLabel(hostname),
            state: 'unknown',
            availability: null,
          };
        }

        return {
          hostname,
          label: toLabel(hostname),
          state: node.Status?.State === 'ready' ? 'ready' : 'down',
          availability: node.Spec?.Availability ?? null,
        };
      });

      return { nodes };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`getStatus failed: ${message}`);

      return {
        nodes: KNOWN_HOSTNAMES.map((hostname) => ({
          hostname,
          label: toLabel(hostname),
          state: 'unknown',
          availability: null,
        })),
        error: message,
      };
    }
  }

  private proxyUrl(): string {
    return (
      this.configService.get<string>('DOCKER_PROXY_URL') || DEFAULT_PROXY_URL
    );
  }
}
