import { hideActionTail } from './chatActions';

/** "7 с", "1 мин 5 с" — how long a reply has been awaited. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));

  return seconds < 60 ? `${seconds} с` : `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
}

interface PendingMessage {
  status: string;
  progress?: string | null;
  createdAt: string;
}

/**
 * What the bubble of a reply that is not finished shows instead of an empty box and a bare loader: the reply as far as the
 * model has written it, or — until the first words arrive — which stage it is at (waiting for a worker / the model is
 * working) and for how long, ticking every second so it is plain that it is alive.
 */
export function pendingBubbleText(message: PendingMessage, now: number): string {
  const partial = hideActionTail(message.progress ?? '');

  if (partial) return partial;

  const waited = formatElapsed(now - new Date(message.createdAt).getTime());

  return message.status === 'pending' ? `⏳ Ждём свободный worker… ${waited}` : `⏳ Модель работает… ${waited}`;
}

/** Whether the reply has started to arrive (the page then shows it streaming rather than "thinking"). */
export function hasStreamedText(message: PendingMessage): boolean {
  return message.status === 'running' && hideActionTail(message.progress ?? '') !== '';
}
