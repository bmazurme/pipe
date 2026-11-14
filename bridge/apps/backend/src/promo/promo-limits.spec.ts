import { captionLimit, captionProblem, joinCaption } from './promo-limits';

describe('promo limits', () => {
  it('joins the Russian text and the English paragraph with a blank line', () => {
    expect(joinCaption('Привет', 'Hello')).toBe('Привет\n\nHello');
    expect(joinCaption('  Привет ', '')).toBe('Привет');
    expect(joinCaption('', ' Hello ')).toBe('Hello');
  });

  it('knows the Telegram caption and message limits', () => {
    expect(captionLimit('telegram', true).limit).toBe(1024);
    expect(captionLimit('telegram', false).limit).toBe(4096);
    expect(captionLimit('instagram', true).limit).toBe(2200);
    expect(captionLimit('youtube', true).limit).toBe(5000);
  });

  it('refuses an empty post', () => {
    expect(captionProblem('telegram', 't', '', ' ', true)).toMatch(
      /нет текста/,
    );
  });

  it('refuses a caption over the limit, counting the joined text', () => {
    const ru = 'а'.repeat(600);
    const en = 'b'.repeat(500);

    // 600 + 2 + 500 = 1102 > 1024 with media, fine as a plain message
    expect(captionProblem('telegram', 't', ru, en, true)).toMatch(
      /1102 из 1024/,
    );
    expect(captionProblem('telegram', 't', ru, en, false)).toBeNull();
  });

  it('checks the YouTube title apart from the description', () => {
    expect(
      captionProblem('youtube', 'x'.repeat(101), 'text', '', true),
    ).toMatch(/Название/);
    expect(
      captionProblem('youtube', 'x'.repeat(100), 'text', '', true),
    ).toBeNull();
  });
});
