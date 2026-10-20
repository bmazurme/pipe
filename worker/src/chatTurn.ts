import { ChatBridgeClient, ClaimedChatTurn } from './chatBridgeClient.js';
import { clipReply } from './chatReply.js';
import { claudeChat } from './chatRunners/claudeChat.js';
import { openAiCompatibleChat } from './chatRunners/openAiCompatibleChat.js';
import { createChatToolset } from './chatTools.js';
import { resolveChatProvider } from './chatProviders.js';
import type { WorkerConfig } from './config.js';
import { chatLogger } from './logger.js';

// Chat has no parcel and no result to upload — one model call per turn, then
// report the reply (or the failure) straight back. Sonnet/Opus spawn the
// same claude CLI Worker jobs use (a scratch work dir only because the CLI
// requires a cwd, removed right after); gpt/deepseek/qwen share the exact
// OpenAI-compatible provider config jobs use, nothing about execution.
export async function processChatTurn(client: ChatBridgeClient, turn: ClaimedChatTurn, config: WorkerConfig): Promise<void> {
  const clog = chatLogger(turn.messageId);

  const reports: Promise<void>[] = [];

  try {
    const provider = resolveChatProvider(turn.model, process.env, turn.provider);

    const reply = provider.tool === 'claude'
      ? await claudeChat(turn.history, provider.claudeModel, config.workDir, config.proxyUrl, (attachmentId) => client.downloadAttachment(turn.messageId, attachmentId), (report) => {
          reports.push(client.reportClaudeUsage(report));
        }, turn.claudeToken, (text) => client.reportProgress(turn.messageId, text), turn.context)
      : await openAiCompatibleChat(turn.history, provider, config.proxyUrl, createChatToolset(config.bridgeApiUrl, config.bridgeApiKey ?? '', config.chatTools), turn.context);

    await Promise.all(reports);
    await client.complete(turn.messageId, clipReply(reply));
    clog.info('succeeded');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    clog.error({ err: error }, 'failed');

    try {
      await client.fail(turn.messageId, message);
    } catch (failError) {
      clog.error({ err: failError }, 'additionally failed to report failure status');
    }
  }
}
