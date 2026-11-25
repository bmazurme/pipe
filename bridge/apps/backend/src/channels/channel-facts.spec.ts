import {
  extractChannels,
  formatChannelFacts,
  parseYoutubeChannelPage,
  parseYoutubeFeed,
} from './channel-facts';

describe('extractChannels', () => {
  it('finds a YouTube handle and an Instagram profile in a task, once each', () => {
    const text =
      'Проанализируй https://www.youtube.com/@Ntlstl и https://www.instagram.com/ntlstlab (а ещё https://www.youtube.com/@ntlstl/videos, https://www.instagram.com/ntlstlab/).';

    expect(extractChannels(text)).toEqual([
      {
        kind: 'youtube',
        handle: '@Ntlstl',
        url: 'https://www.youtube.com/@Ntlstl',
      },
      {
        kind: 'instagram',
        handle: 'ntlstlab',
        url: 'https://www.instagram.com/ntlstlab/',
      },
    ]);
  });

  it('takes a channel id link, ignores single posts and reserved paths, and caps the count', () => {
    expect(
      extractChannels(
        'https://www.youtube.com/channel/UCtYtUOrF1DEpg-YtgLUEJDQ https://www.instagram.com/p/abc123/ https://www.instagram.com/explore/ https://www.youtube.com/watch?v=xyz',
      ),
    ).toEqual([
      {
        kind: 'youtube',
        handle: 'channel/UCtYtUOrF1DEpg-YtgLUEJDQ',
        url: 'https://www.youtube.com/channel/UCtYtUOrF1DEpg-YtgLUEJDQ',
      },
    ]);

    const many = Array.from(
      { length: 6 },
      (_, i) => `https://www.instagram.com/user${i}/`,
    ).join(' ');

    expect(extractChannels(many)).toHaveLength(3);
  });

  it('is empty for a task with no channel', () => {
    expect(extractChannels('Обнови README и посчитай шпангоуты')).toEqual([]);
  });
});

describe('parseYoutubeChannelPage', () => {
  const html = `<html><head>
    <meta property="og:title" content="Ntlstl">
    <meta property="og:description" content="NTLSTL — an open build log of a 3D-printed RC boat (Proto 450)">
    <link rel="alternate" type="application/rss+xml" title="RSS" href="https://www.youtube.com/feeds/videos.xml?channel_id=UCtYtUOrF1DEpg-YtgLUEJDQ">
    </head><body>..."content":"4 subscribers"...,"content":"4 videos"...</body></html>`;

  it('reads the title, description, counts and channel id the page prints', () => {
    expect(parseYoutubeChannelPage(html)).toEqual({
      title: 'Ntlstl',
      description:
        'NTLSTL — an open build log of a 3D-printed RC boat (Proto 450)',
      subscribers: '4',
      videos: '4',
      channelId: 'UCtYtUOrF1DEpg-YtgLUEJDQ',
    });
  });

  it('keeps abbreviated counts as printed and finds nothing on an unrelated page', () => {
    expect(
      parseYoutubeChannelPage('<p>1.2K subscribers</p><p>1,045 videos</p>'),
    ).toMatchObject({ subscribers: '1.2K', videos: '1,045' });
    expect(parseYoutubeChannelPage('<html>consent</html>')).toEqual({
      title: null,
      description: null,
      subscribers: null,
      videos: null,
      channelId: null,
    });
  });
});

describe('parseYoutubeFeed', () => {
  it('lists the newest videos with their dates', () => {
    const xml = `<feed><title>Ntlstl</title>
      <entry><title>Первый спуск &amp; тест</title><published>2026-10-05T10:00:00+00:00</published></entry>
      <entry><title>Печать корпуса</title><published>2026-09-20T08:00:00+00:00</published></entry></feed>`;

    expect(parseYoutubeFeed(xml)).toEqual([
      { title: 'Первый спуск & тест', published: '2026-10-05' },
      { title: 'Печать корпуса', published: '2026-09-20' },
    ]);
    expect(parseYoutubeFeed(xml, 1)).toHaveLength(1);
  });
});

describe('formatChannelFacts', () => {
  const at = new Date('2026-11-26T12:34:00Z');
  const youtube = {
    kind: 'youtube' as const,
    handle: '@Ntlstl',
    url: 'https://www.youtube.com/@Ntlstl',
  };
  const instagram = {
    kind: 'instagram' as const,
    handle: 'ntlstlab',
    url: 'https://www.instagram.com/ntlstlab/',
  };

  it('is empty when there is nothing to say', () => {
    expect(formatChannelFacts([], at)).toBe('');
  });

  it('states the numbers it has, and says plainly what it could not get', () => {
    const text = formatChannelFacts(
      [
        {
          ref: youtube,
          ok: true,
          youtube: {
            title: 'Ntlstl',
            description: 'Proto 450',
            subscribers: '4',
            videos: '4',
            channelId: 'UCx',
          },
          feed: [{ title: 'Печать корпуса', published: '2026-09-20' }],
        },
        {
          ref: instagram,
          ok: false,
          reason: 'токен не подключён',
        },
      ],
      at,
    );

    expect(text).toContain('2026-11-26 12:34 UTC');
    expect(text).toContain('подписчиков: 4, видео: 4');
    expect(text).toContain('«Печать корпуса» (2026-09-20)');
    expect(text).toContain(
      'Instagram https://www.instagram.com/ntlstlab/: данные получить не удалось — токен не подключён',
    );
    expect(text).toContain('не задавайте по ним вопросов');
  });

  it('describes an Instagram account with its latest captions', () => {
    const text = formatChannelFacts(
      [
        {
          ref: instagram,
          ok: true,
          instagram: {
            username: 'ntlstlab',
            name: 'NTLSTL lab',
            biography: 'RC boats',
            followers: 120,
            following: 15,
            mediaCount: 33,
          },
          posts: [
            {
              caption: 'Спуск на воду\n#proto450',
              timestamp: '2026-11-01T10:00:00+0000',
              type: 'IMAGE',
            },
          ],
        },
      ],
      at,
    );

    expect(text).toContain('подписчиков: 120, публикаций: 33');
    expect(text).toContain('«Спуск на воду #proto450» (2026-11-01)');
  });
});
