import type { WorkerBridgeClient, RemoteJob } from './bridgeClient.js';
import type { ChatBridgeClient, ClaimedChatTurn } from './chatBridgeClient.js';
import type { WorkerConfig } from './config.js';
import { applyRemoteConfig, WorkerRevokedError, type RemoteWorkerConfig } from './remoteConfig.js';
import type { Session } from './session.js';

// The worker's poll loop with everything it touches injected, so what it does when a worker is paused, deleted or loses
// bridge for a moment is tested rather than assumed.
export interface LoopDeps {
  baseConfig: WorkerConfig;
  signal: AbortSignal;
  // Who the process is when it starts (null = not enrolled and asked to stop before it was).
  initialSession: Session | null;
  // Waits for an enrolment after the key was revoked.
  waitForSession: () => Promise<Session | null>;
  makeClients: (session: Session) => { client: WorkerBridgeClient; chatClient: ChatBridgeClient };
  fetchRemoteConfig: (key: string) => Promise<RemoteWorkerConfig>;
  forgetRevokedKey: () => void;
  processJob: (client: WorkerBridgeClient, job: RemoteJob, config: WorkerConfig) => Promise<void>;
  processChatTurn: (chatClient: ChatBridgeClient, turn: ClaimedChatTurn, config: WorkerConfig) => Promise<void>;
  withHeartbeat: <T>(client: WorkerBridgeClient, workerName: string, work: () => Promise<T>) => Promise<T>;
  sleep: (ms: number) => Promise<void>;
  log: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
  };
}

// The worker as bridge knows it: its own name and, for a managed worker, the owner's settings from the Worker page
// (applied before every poll). A legacy worker keeps what the environment says.
export function configFor(baseConfig: WorkerConfig, session: Session, remote: RemoteWorkerConfig | null): WorkerConfig {
  const base: WorkerConfig = { ...baseConfig, workerName: session.name };

  // A managed worker's key only reaches worker routes: the bridge tools for gpt chat need a personal API key.
  return session.mode === 'managed'
    ? { ...(remote ? applyRemoteConfig(base, remote) : base), bridgeApiKey: session.key, chatTools: 'off' }
    : base;
}

export async function runLoop(deps: LoopDeps): Promise<void> {
  const { baseConfig, signal, log } = deps;
  let session = deps.initialSession;
  let config = session ? configFor(baseConfig, session, null) : baseConfig;
  let clients = session ? deps.makeClients(session) : undefined;

  if (session) {
    log.info({ workerName: session.name, mode: session.mode, pollIntervalSec: config.pollIntervalSec }, 'pipe-worker ready');
  }

  while (!signal.aborted && session && clients) {
    let remote: RemoteWorkerConfig | null = null;

    if (session.mode === 'managed') {
      try {
        remote = await deps.fetchRemoteConfig(session.key);
        config = configFor(baseConfig, session, remote);
      } catch (error) {
        if (error instanceof WorkerRevokedError) {
          log.warn({}, 'bridge no longer accepts this worker (deleted or reconnected on the Worker page) — waiting for a new enrolment');
          deps.forgetRevokedKey();
          session = await deps.waitForSession();

          if (session) {
            config = configFor(baseConfig, session, null);
            clients = deps.makeClients(session);
          }
          continue;
        }

        // bridge unreachable for a moment: carry on with the last settings
        log.warn({ err: error }, 'could not fetch settings from bridge — using the last ones');
      }
    }

    // Paused on the Worker page: stays connected (the settings fetch above is its sign of life), takes nothing.
    if (remote && !remote.enabled) {
      await deps.sleep(config.pollIntervalSec * 1000);
      continue;
    }

    let job: RemoteJob | null = null;

    try {
      job = await clients.client.claim(config.workerName);
    } catch (error) {
      log.error({ err: error }, 'job poll failed');
    }

    if (job) {
      await deps.processJob(clients.client, job, config);
      continue;
    }

    if (signal.aborted) break;

    let turn: ClaimedChatTurn | null = null;

    if (!remote || remote.chatEnabled) {
      try {
        turn = await clients.chatClient.claim();
      } catch (error) {
        log.error({ err: error }, 'chat poll failed');
      }
    }

    if (turn) {
      const claimedTurn = turn;
      const { client, chatClient } = clients;

      await deps.withHeartbeat(client, config.workerName, () => deps.processChatTurn(chatClient, claimedTurn, config));
    } else {
      await deps.sleep(config.pollIntervalSec * 1000);
    }
  }
}
