// Longest partial reply kept while a turn runs (a final reply has its own cap below: it goes through complete).
export const MAX_PROGRESS_LENGTH = 60_000;

// Longest final reply a worker may complete a turn with. Kept well under the JSON body limit (config/body-parser.config.ts)
// even for Cyrillic or heavily escaped text; the worker clips a longer reply to this (worker/src/chatReply.ts) instead of losing it.
export const MAX_REPLY_LENGTH = 500_000;

// Longest failure message kept on a failed turn; a worker sends about 550 characters, the rest is cut.
export const MAX_ERROR_MESSAGE_LENGTH = 2000;

// Longest reasoning blob kept on a completed turn (Claude only); the worker clips to this before sending it.
export const MAX_REASONING_LENGTH = 60_000;
