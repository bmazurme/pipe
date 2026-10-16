// Longest partial reply kept while a turn runs (a final reply has no such cap: it goes through complete).
export const MAX_PROGRESS_LENGTH = 60_000;

// Longest failure message kept on a failed turn; a worker sends about 550 characters, the rest is cut.
export const MAX_ERROR_MESSAGE_LENGTH = 2000;
