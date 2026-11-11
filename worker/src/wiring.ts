import { WorkerBridgeClient, type RemoteJob } from './bridgeClient.js';
import { ChatBridgeClient, type ClaimedChatTurn } from './chatBridgeClient.js';
import type { WorkerConfig } from './config.js';
import { forgetRevokedKey } from './session.js';
import type { LoopDeps } from './loop.js';
import { applyRemoteConfig, fetchRemoteConfig, type RemoteWorkerConfig } from './remoteConfig.js';
import type { Session } from './session.js';

export interface WiringInput {
  baseConfig: WorkerConfig;
  signal: AbortSignal;
  initialSession: Session | null;
  waitForEnrolment: () => Promise<Session | null>;
  processJob: (client: WorkerBridgeClient, job: RemoteJob, config: WorkerConfig, signal: AbortSignal) => Promise<void>;
  processChatTurn: (chatClient: ChatBridgeClient, turn: ClaimedChatTurn, config: WorkerConfig, signal: AbortSignal) => Promise<void>;
  withHeartbeat: LoopDeps['withHeartbeat'];
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  unavailableCapabilities?: LoopDeps['unavailableCapabilities'];
  log: LoopDeps['log'];
  /** The worker's own VPN tunnel; absent when this image has none. */
  vpn?: { apply: (links: string | string[] | null | undefined) => Promise<string | null> };
  /** With a VPN configured and its tunnel down, take no jobs (default true). WORKER_VPN_REQUIRED=0 restores the old "go out directly". */
  vpnRequired?: boolean;
  /** Refreshes the Claude plan limits when the settings say a probe is due; absent when this image does not probe. */
  limitsProbe?: { consider: (remote: RemoteWorkerConfig, key: string) => void };
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
      const pool = remote.vpnLinks?.length ? remote.vpnLinks : remote.vpnLink;
      const tunnelProxy = input.vpn ? await input.vpn.apply(pool) : null;
      const configured = Boolean(remote.vpnLinks?.length || remote.vpnLink?.trim());
      const vpnDown = Boolean(input.vpn) && (input.vpnRequired ?? true) && configured && !tunnelProxy;

      const effective = tunnelProxy ? { ...remote, proxyUrl: tunnelProxy, vpnDown: false } : { ...remote, vpnDown };

      // Never waits for the probe: it runs beside the polling, and must not delay or break it.
      // The proxy a run really goes through: the VPN tunnel or the page's address, else the one from the worker's environment
      // (a Swarm stack's vpn-client). Without that last fallback a probe on such a worker went out directly — and hung, the
      // provider being unreachable from there.
      try {
        const runsThrough = applyRemoteConfig(baseConfig, effective).proxyUrl ?? null;

        input.limitsProbe?.consider({ ...effective, proxyUrl: runsThrough }, key);
      } catch {
        // a probe problem must never break the poll
      }

      return effective;
    },
    forgetRevokedKey: () => forgetRevokedKey(baseConfig),
    processJob: (client, job, config) => input.processJob(client, job, config, signal),
    processChatTurn: (chatClient, turn, config) => input.processChatTurn(chatClient, turn, config, signal),
    withHeartbeat: input.withHeartbeat,
    unavailableCapabilities: input.unavailableCapabilities,
    sleep: (ms) => input.sleep(ms, signal),
    log: input.log,
  };
}
