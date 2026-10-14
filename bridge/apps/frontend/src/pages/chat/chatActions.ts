// The model cannot touch a repository itself; it can end a reply with a ```pipe-action block asking for a
// change to an open pull request. The page strips that block from the text and shows it as a card the person
// confirms — nothing runs from the model's words alone.
export interface FixPrAction {
  type: 'fix-pr';
  pr: number;
  instruction: string;
}

const ACTION_BLOCK = /```pipe-action\s*\n([\s\S]*?)```/g;
const MAX_INSTRUCTION = 4000;

function parseAction(raw: string): FixPrAction | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const instruction = typeof value.instruction === 'string' ? value.instruction.trim() : '';

    if (value.type !== 'fix-pr' || !Number.isInteger(value.pr) || (value.pr as number) < 1) return null;
    if (instruction.length < 3 || instruction.length > MAX_INSTRUCTION) return null;

    return { type: 'fix-pr', pr: value.pr as number, instruction };
  } catch {
    return null;
  }
}

// `text` is the reply without any action block; `action` is the last valid one, if any.
export function extractChatAction(content: string): { text: string; action: FixPrAction | null } {
  let action: FixPrAction | null = null;
  const text = content
    .replace(ACTION_BLOCK, (_block, raw: string) => {
      action = parseAction(raw) ?? action;

      return '';
    })
    .trim();

  return { text, action };
}
