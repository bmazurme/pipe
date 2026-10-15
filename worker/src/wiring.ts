import { WorkerBridgeClient, type RemoteJob } from './bridgeClient.js';
import { ChatBridgeClient, type ClaimedChatTurn } from './chatBridgeClient.js';
import type { WorkerConfig } from './config.js';
import { forgetRevokedKey } from './session.js';
import type { LoopDeps } from './loop.js';
import { fetchRemoteConfig } from './remoteConfig.js';
import type { Session } from './session.js';

export interface WiringInput {
  baseConfig: WorkerConfig;
  signal: AbortSignal;
  initialSession: Session | null;
  waitForEnrolment: () => Promise<Session | null>;
  processJob: (client: WorkerBridgeClient, job: RemoteJob, config: WorkerConfig, signal: AbortSignal) => Promise<void>;
  processChatTurn: (chatClient: ChatBridgeClient, turn: ClaimedChatTurn, config: WorkerConfig) => Promise<void>;
  withHeartbeat: LoopDeps['withHeartbeat'];
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  log: LoopDeps['log'];
  /** The worker's own VPN tunnel; absent when this image has none. */
  vpn?: { apply: (link: string | null | undefined) => Promise<string | null> };
}

// Joins the loop to the real bridge: clients carry the session's key and the base URL, settings come from that same
// URL, a revoked key is erased from the state directory.
export function buildLoopDeps(input: WiringInput): LoopDeps {
  const { baseConfig, signal } = input;

  return {
    baseConfig,
    signal,
    initialSession: input.initialSession,
    waitForSession: input.waitForEnrolment,
    makeClients: (session) => ({
      client: new WorkerBridgeClient(baseConfig.bridgeApiUrl, session.key),
      chatClient: new ChatBridgeClient(baseConfig.bridgeApiUrl, session.key),
    }),
    fetchRemoteConfig: async (key) => {
      const remote = await fetchRemoteConfig(baseConfig.bridgeApiUrl, key);
      // The VPN set on the page wins over a proxy address; no working tunnel leaves the proxy settings as they were.
      const tunnelProxy = input.vpn ? await input.vpn.apply(remote.vpnLink) : null;

      return tunnelProxy ? { ...remote, proxyUrl: tunnelProxy } : remote;
    },
    forgetRevokedKey: () => forgetRevokedKey(baseConfig),
    processJob: (client, job, config) => input.processJob(client, job, config, signal),
    processChatTurn: input.processChatTurn,
    withHeartbeat: input.withHeartbeat,
    sleep: (ms) => input.sleep(ms, signal),
    log: input.log,
  };
}
