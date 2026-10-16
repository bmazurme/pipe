// The model cannot touch a repository itself; it can end a reply with a ```pipe-action block asking for a
// change to an open pull request. The page strips that block from the text and shows it as a card the person
// confirms — nothing runs from the model's words alone.
export interface FixPrAction {
  type: 'fix-pr';
  pr: number;
  instruction: string;
}

export interface MergePrAction {
  type: 'merge-pr';
  pr: number;
}

export type ChatAction = FixPrAction | MergePrAction;

const ACTION_BLOCK = /```pipe-action\s*\n([\s\S]*?)```/g;
const MAX_INSTRUCTION = 4000;

function parseAction(raw: string): ChatAction | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const validPr = Number.isInteger(value.pr) && (value.pr as number) >= 1;

    if (!validPr) return null;

    if (value.type === 'merge-pr') {
      return { type: 'merge-pr', pr: value.pr as number };
    }

    const instruction = typeof value.instruction === 'string' ? value.instruction.trim() : '';

    if (value.type !== 'fix-pr') return null;
    if (instruction.length < 3 || instruction.length > MAX_INSTRUCTION) return null;

    return { type: 'fix-pr', pr: value.pr as number, instruction };
  } catch {
    return null;
  }
}

// `text` is the reply without any action block; `action` is the last valid one, if any.
export function extractChatAction(content: string): { text: string; action: ChatAction | null } {
  let action: ChatAction | null = null;
  const text = content
    .replace(ACTION_BLOCK, (_block, raw: string) => {
      action = parseAction(raw) ?? action;

      return '';
    })
    .trim();

  return { text, action };
}

// A reply that is still being written may stop in the middle of an action block; show nothing from its opening on, so the
// raw JSON never flashes in the bubble before the finished block becomes a card.
export function hideActionTail(partial: string): string {
  const start = partial.indexOf('```pipe-action');

  return (start === -1 ? partial : partial.slice(0, start)).trimEnd();
}
