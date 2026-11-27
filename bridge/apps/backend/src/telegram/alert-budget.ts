// R6 — the alert budget. Everything the bridge says to the owner on its own goes through NotifyService; this decides, before a message leaves,
// whether it is worth a message of its own. Pure and in memory (a restart forgets it, which costs at most one repeated message).
//
//   dedupe   the SAME text again within DEDUPE_MS is not said again. EXACT text, not «the same with the numbers stripped»: «Задача #7 → PR #55»
//            and «Задача #8 → PR #56» are two events, and only a message that is word for word the same is certainly redundant.
//   hold     more than BURST_LIMIT ordinary messages within BURST_WINDOW_MS is a burst (a batch of runs started, a board coming back): the rest are
//            kept and go out as ONE grouped message a minute later, instead of a message each.
//   urgent   goes through a burst (it cannot wait), but is deduplicated like the rest, over a shorter window.
//
// Quiet hours (the morning digest) are NotifyService's own and unchanged; what is deduplicated here is deduplicated before it reaches the night queue.

export const DEDUPE_MS = 60 * 60_000;
export const URGENT_DEDUPE_MS = 15 * 60_000;
export const BURST_LIMIT = 3;
export const BURST_WINDOW_MS = 2 * 60_000;
// The ordinary messages per day the owner should get; the card on the Dashboard measures against it.
export const DAILY_TARGET = 5;
// A day with this many ordinary messages is noise, not news.
export const DAILY_NOISY = 15;

export type Decision = 'send' | 'dedupe' | 'hold';

const MAX_REMEMBERED = 500;

export class AlertGate {
  private readonly seen = new Map<string, number>();
  private sends: number[] = [];

  // Whether this message goes out now, is a repeat, or joins the burst. Does not remember it: the caller says what became of it (`remember`).
  decide(text: string, urgent: boolean, now: number): Decision {
    const last = this.seen.get(text);

    if (
      last !== undefined &&
      now - last < (urgent ? URGENT_DEDUPE_MS : DEDUPE_MS)
    ) {
      return 'dedupe';
    }

    if (urgent) return 'send';

    this.sends = this.sends.filter((at) => now - at < BURST_WINDOW_MS);

    return this.sends.length >= BURST_LIMIT ? 'hold' : 'send';
  }

  // The message was accepted (sent, queued for the night, or held for the group): its text is a repeat from now on.
  remember(text: string, now: number): void {
    this.seen.set(text, now);

    if (this.seen.size > MAX_REMEMBERED) {
      for (const [key, at] of this.seen) {
        if (now - at >= DEDUPE_MS) this.seen.delete(key);
      }

      // Still too many (all recent): drop the oldest.
      while (this.seen.size > MAX_REMEMBERED) {
        const oldest = this.seen.keys().next().value as string;

        this.seen.delete(oldest);
      }
    }
  }

  // An ordinary message left now: it counts toward the burst.
  recordSent(now: number): void {
    this.sends.push(now);
  }
}

// What the daily statistics call a kind of message: the first line, digits as N, short — «🔴 Задача #7: не удалось открыть PR — …» and the same for
// task #9 are one kind. Only for «who is noisy»; never for deciding anything.
export function kindOf(text: string): string {
  return (text.split('\n')[0] ?? '')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

// The grouped message for what a burst held back: one line each, with the local time.
export function buildBurstMessage(
  items: Array<{ text: string; time: string }>,
): string {
  const lines = items.map(
    (item) => `• ${item.time} ${item.text.split('\n')[0]}`,
  );

  return [`🔔 Ещё ${items.length} подряд (сгруппировано):`, ...lines].join(
    '\n',
  );
}

export type Verdict = 'ok' | 'over' | 'noisy';

export function verdictOf(ordinaryToday: number): Verdict {
  return ordinaryToday >= DAILY_NOISY
    ? 'noisy'
    : ordinaryToday > DAILY_TARGET
      ? 'over'
      : 'ok';
}
