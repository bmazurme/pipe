// Worker's log flush batches ~1.5s of output at a time; 64 KiB sits comfortably
// above that while keeping each append (which rewrites the whole `logs` column)
// bounded.
export const MAX_LOG_CHUNK_LENGTH = 64 * 1024;
export const MAX_ERROR_MESSAGE_LENGTH = 8 * 1024;
