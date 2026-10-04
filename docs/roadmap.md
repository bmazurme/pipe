# Roadmap (not yet implemented)

Part of [ECOSYSTEM.md](../ECOSYSTEM.md)'s cross-cutting detail — see that
file for the full index. (Multi-parcel addressing used to be listed here —
it's now mostly addressed, see [parcel.md](parcel.md#multi-parcel-addressing).)

## Chat: file/image attachments

`@gravity-ui/aikit`'s frontend plumbing for this already exists —
`TSubmitData.attachments?: File[]`, `TUserMessage.images?`/`fileAttachments?`,
a ready-made `AttachmentPicker`/`FileUploadDialog` pair, opt-in via
`PromptInput`'s `footerProps.showAttachment`/`attachmentContent` — but
everything behind bridge's chat module is plain text end to end:
`ChatMessage.content` (`bridge/apps/backend/src/chat/entities/chat-message.entity.ts`)
is a `text` column, worker's `ChatHistoryEntry.content`
(`worker/src/chatBridgeClient.ts`) is a `string`, and both chat runners
(`worker/src/chatRunners/claudeChat.ts`'s flat-string `buildPrompt`,
`worker/src/chatRunners/openAiCompatibleChat.ts`'s `{role, content}` body)
have no slot for binary/image data.

Building this needs: a new attachment entity + bridge's existing
`StorageService` (the same relay sync/reports already use) for the actual
bytes, an upload route, `ChatHistoryEntry` gaining an image/attachment
field, and then per-provider divergence on the worker side — Claude's and
GPT's vision-capable models take image content blocks directly; DeepSeek/
Qwen's OpenAI-compatible vision support is inconsistent and model-dependent;
non-image file attachments (PDFs, code files) would need yet another path,
since most providers don't accept arbitrary files and this would mean
extracting/inlining text server-side before it reaches the model. A
multi-day feature, not a small addition on top of AIKit's existing UI
pieces.

## sync: persisted per-project context

Parcel names already encode `${projectId}-${iid}`
(`sync/src/commands/pushIssue.ts`'s `issueParcelName`), and there's already
per-*issue* bookkeeping keyed the same way — `sync/src/agentState.ts`
(`recordOwnOutput`, an anti-echo guard so agent-runner doesn't reprocess its
own prior output) and `sync/src/gitlabWorkerState.ts` (`recordPushed`, an
anti-resend guard). Neither feeds anything back into the agent's prompt:
`sync/src/claudeRunner.ts`'s `buildIssuePrompt` builds one flat `claude -p`
call per issue from just the title + description, with no session resume
and no memory of prior issues on the same project.

That's not an oversight — each task runs in its own throwaway git worktree
with `--dangerously-skip-permissions` (`claudeRunner.ts`'s header comment,
`sync/ROADMAP.md` section 3.6), a deliberate
isolation boundary meant to keep one task's mistakes from compounding into
the next. An auto-accumulating "memory" of prior agent runs on a project
would cut against that goal directly, so it isn't recommended.

The safer version: a **human-curated, static per-project context file**,
opt-in via a new `contextPath` field on `ProjectConfig` (`sync/src/types.ts`)
— resolved the same way `dictionary`/`publicKeyPath` already are — included
automatically in every push for that project. It would flow through the
existing include/walk → dictionary-substitution → leak-scan pipeline for
free and get stitched into `buildIssuePrompt`/the archive manifest, giving
every issue on a project the same baseline notes (stack, gotchas,
conventions) without the risk of silently-growing, agent-written state.

## Everything in docs/improvements/

Two longer-form technical-debt/feature analyses live in
[docs/improvements/](improvements/) rather than here —
[IMPROVEMENTS_TECH.md](improvements/IMPROVEMENTS_TECH.md)
(security/architecture/tests/DX across every product, with a status column
tracking what's since been built) and
[IMPROVEMENTS_HARNESS.md](improvements/IMPROVEMENTS_HARNESS.md) (turning
`harness` from a read-only report into an actual assistant). Check those
for anything not covered above.
