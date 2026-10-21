import { ChatBridgeClient, ClaimedChatTurn } from './chatBridgeClient.js';
import { clipReasoning, clipReply } from './chatReply.js';
import { claudeChat } from './chatRunners/claudeChat.js';
import { openAiCompatibleChat } from './chatRunners/openAiCompatibleChat.js';
import { createChatToolset } from './chatTools.js';
import { resolveChatProvider } from './chatProviders.js';
import { CancelledError } from './cancelled.js';
import { CHAT_TURN_TIMEOUT_SEC, type WorkerConfig } from './config.js';
import { chatLogger } from './logger.js';
import type { ClaudeReport } from './modelRunners/claudeUsage.js';
import { ClaudeRunError } from './modelRunners/claudeRunner.js';

// Chat has no parcel and no result to upload — one model call per turn, then
// report the reply (or the failure) straight back. Sonnet/Opus spawn the
// same claude CLI Worker jobs use (a scratch work dir only because the CLI
// requires a cwd, removed right after); gpt/deepseek/qwen share the exact
// OpenAI-compatible provider config jobs use, nothing about execution.
export const CHAT_SHUTDOWN_FAILURE_MESSAGE = 'Worker был остановлен';

export function chatTimeoutMessage(timeoutSec: number): string {
  return `Модель не ответила за ${Math.max(1, Math.ceil(timeoutSec / 60))} мин`;
}

export async function processChatTurn(
  client: ChatBridgeClient,
  turn: ClaimedChatTurn,
  config: WorkerConfig,
  options: { shutdown?: AbortSignal } = {},
): Promise<void> {
  const chatTimeoutSec = config.chatTimeoutSec ?? CHAT_TURN_TIMEOUT_SEC;
  const clog = chatLogger(turn.messageId);

  const reports: Promise<void>[] = [];

  try {
    const provider = resolveChatProvider(turn.model, process.env, turn.provider);

    const { text, reasoning } = provider.tool === 'claude'
      ? await claudeChat(turn.history, provider.claudeModel, config.workDir, config.proxyUrl, (attachmentId) => client.downloadAttachment(turn.messageId, attachmentId), (report) => {
          reports.push(client.reportClaudeUsage(report));
        }, turn.claudeToken, (text) => client.reportProgress(turn.messageId, text), turn.context, chatTimeoutSec * 1000, options.shutdown)
      : { text: await openAiCompatibleChat(turn.history, provider, config.proxyUrl, createChatToolset(config.bridgeApiUrl, config.bridgeApiKey ?? '', config.chatTools), turn.context), reasoning: null };

    await Promise.all(reports);
    await client.complete(turn.messageId, clipReply(text), reasoning ? clipReasoning(reasoning) : null);
    clog.info('succeeded');
  } catch (error) {
    // A turn that was stopped or timed out still cost tokens.
    const failedReport = (error as { report?: ClaudeReport } | null)?.report;
    if (failedReport) {
      try {
        await client.reportClaudeUsage(failedReport);
      } catch (usageError) {
        clog.warn({ err: usageError }, 'could not report usage of a turn that did not finish');
      }
    }

    const message =
      error instanceof CancelledError
        ? CHAT_SHUTDOWN_FAILURE_MESSAGE
        : error instanceof ClaudeRunError
          ? chatTimeoutMessage(chatTimeoutSec)
          : error instanceof Error
            ? error.message
            : String(error);
    clog.error({ err: error }, 'failed');

    try {
      await client.fail(turn.messageId, message);
    } catch (failError) {
      clog.error({ err: failError }, 'additionally failed to report failure status');
    }
  }
}
