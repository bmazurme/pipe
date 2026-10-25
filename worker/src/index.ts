#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.js';
import { verifyRunAs } from './modelRunners/claudeRunner.js';
import { processChatTurn } from './chatTurn.js';
import { withHeartbeat } from './heartbeat.js';
import { processJob } from './jobRunner.js';
import { logger } from './logger.js';
import { runLoop } from './loop.js';
import { waitForSession } from './session.js';
import { sleep } from './sleep.js';
import { workerVersion } from './version.js';
import { LimitsProbe } from './limitsProbe.js';
import { VpnTunnel } from './vpn/tunnel.js';
import { buildLoopDeps } from './wiring.js';
import { resolveFileSecrets, SECRET_ENV_KEYS } from './secrets.js';

// Aborted on SIGTERM/SIGINT: the main loop stops claiming and a running job is failed with a clear reason.
const shutdown = new AbortController();
// A second signal while a grace period is running: stop the current job at once.
const forceShutdown = new AbortController();

async function main(): Promise<void> {
  resolveFileSecrets(process.env, SECRET_ENV_KEYS);
  const baseConfig = loadConfig();
  // Fail loudly rather than silently run job code as the worker's own user.
  if (baseConfig.runAs) verifyRunAs(baseConfig.runAs);

  logger.info(
    { bridgeApiUrl: baseConfig.bridgeApiUrl, stateDir: baseConfig.stateDir, mode: baseConfig.bridgeApiKey ? 'api-key (legacy)' : 'enrolment' },
    'pipe-worker starting',
  );

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      if (shutdown.signal.aborted) {
        logger.info({ signal: sig }, 'second signal, stopping at once');
        forceShutdown.abort();
        return;
      }
      logger.info({ signal: sig, graceSec: baseConfig.shutdownGraceSec }, 'shutting down');
      shutdown.abort();
    });
  }

  // The worker's own VPN, when one is set on the Worker page (needs the xray binary the image ships).
  const vpn = new VpnTunnel({
    dir: baseConfig.stateDir,
    xrayBin: process.env.XRAY_BIN,
    fingerprint: process.env.WORKER_VPN_FINGERPRINT,
    log: logger,
  });
  const sessionDeps = { version: workerVersion(), log: logger };
  const waitForEnrolment = () => waitForSession(baseConfig, sessionDeps, sleep, shutdown.signal);

  await runLoop(
    buildLoopDeps({
      baseConfig,
      signal: shutdown.signal,
      initialSession: await waitForEnrolment(),
      waitForEnrolment,
      processJob: (client, job, config, signal) => processJob(client, job, config, { shutdown: signal, forceShutdown: forceShutdown.signal }),
      processChatTurn: (chatClient, turn, config, signal) => processChatTurn(chatClient, turn, config, { shutdown: signal }),
      withHeartbeat,
      sleep,
      log: logger,
      vpn,
      limitsProbe: new LimitsProbe({ apiUrl: baseConfig.bridgeApiUrl, workDir: baseConfig.workDir, log: logger }),
    }),
  );

  vpn.stop();
  logger.info('pipe-worker stopped');
  process.exit(0);
}

// Guards against running main() as a side effect of a test file importing
// this module — only run it when this file is the actual process entry
// point (`node dist/index.js`).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
