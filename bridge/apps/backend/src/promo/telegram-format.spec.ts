import {
  messageUrl,
  parseChatRef,
  planSend,
  toTelegramHtml,
  visibleText,
  type MediaFile,
} from './telegram-format';

const file = (over: Partial<MediaFile> = {}): MediaFile => ({
  id: 1,
  name: 'a.png',
  mime: 'image/png',
  size: 1000,
  ...over,
});

describe('toTelegramHtml', () => {
  it('turns **bold** and `code` into tags', () => {
    expect(toTelegramHtml('**Заголовок**\nтекст `x=1`')).toBe(
      '<b>Заголовок</b>\nтекст <code>x=1</code>',
    );
  });

  it('escapes everything else, so a post can never be read as markup', () => {
    expect(toTelegramHtml('1 < 2 & <b>не жирный</b> <script>')).toBe(
      '1 &lt; 2 &amp; &lt;b&gt;не жирный&lt;/b&gt; &lt;script&gt;',
    );
    expect(toTelegramHtml('**a < b**')).toBe('<b>a &lt; b</b>');
  });

  it('leaves a lone or empty mark as it is', () => {
    expect(toTelegramHtml('2 ** 3 и ****')).toBe('2 ** 3 и ****');
  });
});

describe('visibleText', () => {
  it('drops the marks, so the caption limit counts what a reader sees', () => {
    expect(visibleText('**Привет** `мир`')).toBe('Привет мир');
  });
});

describe('planSend', () => {
  it('is a message with no files', () => {
    expect(planSend([])).toEqual({ kind: 'text' });
  });

  it('picks the method for a single file by its type', () => {
    expect(planSend([file()])).toMatchObject({
      method: 'sendPhoto',
      field: 'photo',
    });
    expect(
      planSend([file({ mime: 'video/mp4', name: 'v.mp4' })]),
    ).toMatchObject({ method: 'sendVideo', field: 'video' });
    expect(
      planSend([file({ mime: 'image/gif', name: 'g.gif' })]),
    ).toMatchObject({ method: 'sendAnimation', field: 'animation' });
  });

  it('makes an album of two to ten, and refuses more or a gif inside', () => {
    expect(
      planSend([file({ id: 1 }), file({ id: 2, mime: 'video/mp4' })]),
    ).toMatchObject({ kind: 'group' });
    expect(() =>
      planSend(Array.from({ length: 11 }, (_, i) => file({ id: i }))),
    ).toThrow(/не больше 10/);
    expect(() =>
      planSend([file(), file({ id: 2, mime: 'image/gif', name: 'g.gif' })]),
    ).toThrow(/Гифка/);
  });

  it('refuses a file the bot cannot upload', () => {
    expect(() => planSend([file({ size: 11 * 1024 * 1024 })])).toThrow(
      /больше 10 МБ/,
    );
    expect(() =>
      planSend([
        file({ mime: 'video/mp4', name: 'big.mp4', size: 60 * 1024 * 1024 }),
      ]),
    ).toThrow(/«big.mp4» больше 50 МБ/);
    // a photo may be up to 10 MB, a video up to 50
    expect(
      planSend([file({ mime: 'video/mp4', size: 40 * 1024 * 1024 })]),
    ).toMatchObject({ kind: 'single' });
  });
});

describe('messageUrl', () => {
  it('links a public chat by name and a private one by its id', () => {
    expect(messageUrl({ chatId: '-1001', username: 'ntlstl_news' }, 7)).toBe(
      'https://t.me/ntlstl_news/7',
    );
    expect(messageUrl({ chatId: '-1001234567890', username: null }, 7)).toBe(
      'https://t.me/c/1234567890/7',
    );
    expect(messageUrl({ chatId: '12345', username: null }, 7)).toBeNull();
  });
});

describe('parseChatRef', () => {
  it.each([
    ['-1001234567890', '-1001234567890'],
    ['@ntlstl_news', '@ntlstl_news'],
    ['ntlstl_news', '@ntlstl_news'],
    ['https://t.me/ntlstl_news', '@ntlstl_news'],
    ['t.me/ntlstl_news/', '@ntlstl_news'],
  ])('reads %s', (input, ref) => {
    expect(parseChatRef(input)).toBe(ref);
  });

  it.each(['https://t.me/+oJq2JlgIkIRmMWQy', 'a b', '', '12', '@x'])(
    'refuses %s',
    (input) => {
      expect(parseChatRef(input)).toBeNull();
    },
  );
});
