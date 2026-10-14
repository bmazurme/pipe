import { describe, expect, it } from 'vitest';

import { extractChatAction } from './chatActions';

const block = (json: string) => '```pipe-action\n' + json + '\n```';

describe('extractChatAction', () => {
  it('leaves a plain reply alone', () => {
    expect(extractChatAction('Привет')).toEqual({ text: 'Привет', action: null });
  });

  it('takes the action out of the text', () => {
    const reply = `Предлагаю правку.\n\n${block('{"type":"fix-pr","pr":304,"instruction":"Rename the helper"}')}`;

    expect(extractChatAction(reply)).toEqual({
      text: 'Предлагаю правку.',
      action: { type: 'fix-pr', pr: 304, instruction: 'Rename the helper' },
    });
  });

  it('still hides a block it cannot use, without offering anything', () => {
    for (const json of ['{oops', '{"type":"merge","pr":1,"instruction":"abc"}', '{"type":"fix-pr","pr":0,"instruction":"abc"}', '{"type":"fix-pr","pr":3,"instruction":" "}']) {
      expect(extractChatAction(`Ок\n${block(json)}`)).toEqual({ text: 'Ок', action: null });
    }
  });

  it('refuses a request that is not a whole number of a pull request', () => {
    expect(extractChatAction(block('{"type":"fix-pr","pr":"304","instruction":"abc"}')).action).toBeNull();
    expect(extractChatAction(block('{"type":"fix-pr","pr":3.5,"instruction":"abc"}')).action).toBeNull();
  });
});
