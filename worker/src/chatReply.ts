// Mirrors bridge's MAX_REPLY_LENGTH (bridge/apps/backend/src/chat/chat.limits.ts): the longest reply bridge accepts on
// complete. Characters as JS counts them (UTF-16 units), same as class-validator's MaxLength.
export const MAX_REPLY_LENGTH = 500_000;

export const TRUNCATED_REPLY_NOTE = '\n\n…ответ обрезан: он длиннее, чем принимает bridge.';

// A reply too long for bridge is cut (with a visible note) rather than rejected — it was already generated and paid for.
export function clipReply(reply: string, maxLength = MAX_REPLY_LENGTH): string {
  if (reply.length <= maxLength) return reply;

  let end = maxLength - TRUNCATED_REPLY_NOTE.length;
  // Don't leave half of a surrogate pair (an emoji, say) at the cut.
  const last = reply.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;

  return `${reply.slice(0, end)}${TRUNCATED_REPLY_NOTE}`;
}
