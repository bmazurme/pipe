
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { Request, Response } from 'express';
import cors from 'cors';

import { handleCounts, handleAddOffDay, handleRemoveOffDay, handleImportDayOffs } from './counts/handler';
import { handleReport, handlePushReport } from './reports/handler';
import { handleGetSettings, handleSetSettings, handleExportSettingsBundle, handleImportSettingsBundle } from './settings/handler';
import { handleGetProjectDict, handleAddProjectCode, handleRemoveProjectCode } from './reports/project-dict-handler';
import {
  handleListSubscriptionIssues,
  handleInitSubscriptionIssue,
  handleGetSubscriptionDraft,
  handlePushSubscriptionIssue,
  handlePullSubscriptionIssue,
  handlePublishSubscriptionIssue,
  handleGetSubscriptionIssueTime,
  handleCreateManualSubscriptionIssue,
  handleRemoveSubscriptionIssue,
} from './subscription/handler';
import {
  handleGetSubscriptionConfig,
  handleAddTrackedProject,
  handleRemoveTrackedProject,
  handleAddDictionaryEntry,
  handleRemoveDictionaryEntry,
  handleUpdateDictionaryEntry,
  handleImportDictionary,
  handleAddCommentTemplate,
  handleRemoveCommentTemplate,
  handleSetEncryptionSettings,
  handleGenerateEncryptionKeyPair,
  handleSetLeakScanStrict,
} from './subscription/config-handler';
import { handleCreateBacklogIssues, handleGetBacklog, handleStartAnalysis } from './subscription/analysis-handler';
import { handlePurgeApply } from './subscription/purge-handler';
import { startAutopilot } from './subscription/autopilot';
import { setupProxy } from './utils/setup-proxy';

setupProxy();

const app = express();
const host = process.env.HOST || '127.0.0.1';
const startPort = Number(process.env.PORT) || 4000;

// Set only by the Docker image and the standalone launcher script (run.sh/
// run.bat) — both build the client first and run this as the only process,
// so nothing else needs to agree on a fixed port. Plain `npm run dev`/`npm
// start` keep today's exact behavior (hard-fail on a taken port) because the
// separately-running Vite dev server has its own build-time-baked API URL
// that a silent port change would break.
const clientDistDir = join(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
const isProductionMode = existsSync(join(clientDistDir, 'index.html'));

app.use(cors());
app.use(express.json());

app.get('/api/counts/:id', handleCounts);
app.post('/api/counts/:id/off-days', handleAddOffDay);
app.delete('/api/counts/:id/off-days/:date', handleRemoveOffDay);
app.post('/api/counts/:id/import-day-offs', handleImportDayOffs);
app.get('/api/reports', handleReport);
app.post('/api/reports/push-to-bridge', handlePushReport);
app.get('/api/settings', handleGetSettings);
app.post('/api/settings', handleSetSettings);
app.get('/api/settings/export', handleExportSettingsBundle);
app.post('/api/settings/import', handleImportSettingsBundle);
app.get('/api/project-dict', handleGetProjectDict);
app.post('/api/project-dict', handleAddProjectCode);
app.delete('/api/project-dict/:code', handleRemoveProjectCode);

app.get('/api/subscription/issues', handleListSubscriptionIssues);
app.post('/api/subscription/issues/manual', handleCreateManualSubscriptionIssue);
app.post('/api/subscription/issues/:projectId/:iid/init', handleInitSubscriptionIssue);
app.get('/api/subscription/issues/:projectId/:iid/draft', handleGetSubscriptionDraft);
app.post('/api/subscription/issues/:projectId/:iid/push', handlePushSubscriptionIssue);
app.post('/api/subscription/issues/:projectId/:iid/pull', handlePullSubscriptionIssue);
app.post('/api/subscription/issues/:projectId/:iid/publish', handlePublishSubscriptionIssue);
app.get('/api/subscription/issues/:projectId/:iid/time', handleGetSubscriptionIssueTime);
app.delete('/api/subscription/issues/:projectId/:iid', handleRemoveSubscriptionIssue);
app.get('/api/subscription/config', handleGetSubscriptionConfig);
app.post('/api/subscription/config/tracked-projects', handleAddTrackedProject);
app.delete('/api/subscription/config/tracked-projects/:gitlabProjectId', handleRemoveTrackedProject);
app.post('/api/subscription/config/dictionary', handleAddDictionaryEntry);
app.post('/api/subscription/config/dictionary/import', handleImportDictionary);
app.put('/api/subscription/config/dictionary/:key', handleUpdateDictionaryEntry);
app.delete('/api/subscription/config/dictionary/:key', handleRemoveDictionaryEntry);
app.post('/api/subscription/config/comment-templates', handleAddCommentTemplate);
app.delete('/api/subscription/config/comment-templates/:id', handleRemoveCommentTemplate);
app.put('/api/subscription/config/encryption', handleSetEncryptionSettings);
app.post('/api/subscription/config/encryption/generate', handleGenerateEncryptionKeyPair);
app.put('/api/subscription/config/leak-scan-strict', handleSetLeakScanStrict);
app.post('/api/subscription/analysis', handleStartAnalysis);
app.get('/api/subscription/analysis/:projectId/:iid/backlog', handleGetBacklog);
app.post('/api/subscription/analysis/:projectId/:iid/issues', handleCreateBacklogIssues);
app.post('/api/subscription/purge/apply', handlePurgeApply);

if (isProductionMode) {
  app.use(express.static(clientDistDir));
  // Anything that isn't /api/* and isn't a static file falls through to the
  // SPA's own client-side router.
  app.get(/^\/(?!api\/).*/, (req: Request, res: Response) => {
    res.sendFile(join(clientDistDir, 'index.html'));
  });
} else {
  app.get('/', (req: Request, res: Response) => {
    res.json({ message: 'Welcome to the Express + TypeScript Server!' });
  });
}

function startServer(port: number, attemptsLeft: number) {
  const server = app.listen(port, host, () => {
    console.log(`🚀 Сервер запущен: http://${host}:${port}`);
    // Only once this instance actually owns the port: a second copy that
    // loses it must not run its own autopilot first (two of them pull the
    // same result twice — one commit each — before the loser exits).
    startAutopilot();
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EADDRINUSE') {
      throw err;
    }

    if (isProductionMode && attemptsLeft > 0) {
      console.warn(`Порт ${port} занят, пробую ${port + 1}...`);
      startServer(port + 1, attemptsLeft - 1);
      return;
    }

    console.error(`Порт ${port} уже занят другим процессом. Задайте свободный порт через PORT в packages/server/.env и перезапустите.`);
    process.exit(1);
  });
}

startServer(startPort, 20);
