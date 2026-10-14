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
    fetchRemoteConfig: (key) => fetchRemoteConfig(baseConfig.bridgeApiUrl, key),
    forgetRevokedKey: () => forgetRevokedKey(baseConfig),
    processJob: (client, job, config) => input.processJob(client, job, config, signal),
    processChatTurn: input.processChatTurn,
    withHeartbeat: input.withHeartbeat,
    sleep: (ms) => input.sleep(ms, signal),
    log: input.log,
  };
}
