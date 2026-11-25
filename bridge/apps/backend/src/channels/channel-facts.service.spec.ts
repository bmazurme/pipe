import { ChannelFactsService, type HttpGet } from './channel-facts.service';

const PAGE = `<meta property="og:title" content="Ntlstl"><meta property="og:description" content="Proto 450">
<link rel="alternate" href="https://www.youtube.com/feeds/videos.xml?channel_id=UCtYtUOrF1DEpg-YtgLUEJDQ"> 4 subscribers 4 videos`;
const FEED =
  '<feed><entry><title>Печать</title><published>2026-09-20T08:00:00+00:00</published></entry></feed>';

function setup(token: string | null, get: HttpGet) {
  const secrets = { findValueByName: jest.fn().mockResolvedValue(token) };
  const service = new ChannelFactsService(secrets as never);

  service.get = get;

  return { service, secrets };
}

describe('ChannelFactsService', () => {
  it('returns nothing for a task without channels and never touches the network', async () => {
    const get = jest.fn();
    const { service } = setup(null, get);

    await expect(service.describeFor(1, 'просто задача')).resolves.toBe('');
    expect(get).not.toHaveBeenCalled();
  });

  it('reads a YouTube channel from its page and feed', async () => {
    const get = jest.fn(async (url: string) => ({
      status: 200,
      text: url.includes('feeds/') ? FEED : PAGE,
    }));
    const { service } = setup(null, get);
    const text = await service.describeFor(
      1,
      'смотри https://www.youtube.com/@Ntlstl',
    );

    expect(text).toContain('подписчиков: 4, видео: 4');
    expect(text).toContain('«Печать» (2026-09-20)');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('caches a successful read, so two runs in a row fetch once', async () => {
    const get = jest.fn(async () => ({ status: 200, text: PAGE }));
    const { service } = setup(null, get);

    await service.describeFor(1, 'https://www.youtube.com/@Ntlstl');
    await service.describeFor(1, 'https://www.youtube.com/@Ntlstl');

    // page + feed on the first run, nothing on the second
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('says so when YouTube answers with something that is not the channel', async () => {
    const { service } = setup(null, async () => ({
      status: 200,
      text: '<html>consent</html>',
    }));
    const text = await service.describeFor(
      1,
      'https://www.youtube.com/@Ntlstl',
    );

    expect(text).toContain('данные получить не удалось');
  });

  it('survives a network failure and still produces a note', async () => {
    const { service } = setup(null, async () => {
      throw new Error('socket hang up');
    });
    const text = await service.describeFor(
      1,
      'https://www.youtube.com/@Ntlstl',
    );

    expect(text).toContain('сайт не ответил вовремя');
  });

  it("asks for the owner's token for Instagram and does not call Instagram without it", async () => {
    const get = jest.fn();
    const { service, secrets } = setup(null, get);
    const text = await service.describeFor(
      1,
      'https://www.instagram.com/ntlstlab',
    );

    expect(secrets.findValueByName).toHaveBeenCalledWith(
      1,
      'INSTAGRAM_ACCESS_TOKEN',
    );
    expect(text).toContain('токен не подключён');
    expect(get).not.toHaveBeenCalled();
  });

  it("reads the owner's Instagram profile through the official API, and keeps the token out of every message", async () => {
    const get = jest.fn(async (url: string) => {
      if (url.includes('/me/media')) {
        return {
          status: 200,
          text: JSON.stringify({
            data: [
              {
                caption: 'Спуск на воду',
                timestamp: '2026-11-01T10:00:00+0000',
                media_type: 'IMAGE',
              },
            ],
          }),
        };
      }

      return {
        status: 200,
        text: JSON.stringify({
          username: 'NTLSTLab',
          name: 'NTLSTL lab',
          followers_count: 120,
          follows_count: 15,
          media_count: 33,
        }),
      };
    });
    const { service } = setup('SECRET-TOKEN', get);
    const text = await service.describeFor(
      1,
      'https://www.instagram.com/ntlstlab/',
    );

    expect(text).toContain('подписчиков: 120, публикаций: 33');
    expect(text).toContain('«Спуск на воду»');
    expect(text).not.toContain('SECRET-TOKEN');
  });

  it('refuses a token that belongs to another profile and reports an expired one without echoing it', async () => {
    const other = setup('SECRET-TOKEN', async () => ({
      status: 200,
      text: JSON.stringify({ username: 'someoneelse' }),
    }));

    await expect(
      other.service.describeFor(1, 'https://www.instagram.com/ntlstlab/'),
    ).resolves.toContain('другому профилю');

    const expired = setup('SECRET-TOKEN', async () => ({
      status: 400,
      text: '{}',
    }));
    const text = await expired.service.describeFor(
      1,
      'https://www.instagram.com/ntlstlab/',
    );

    expect(text).toContain('недействителен или истёк');
    expect(text).not.toContain('SECRET-TOKEN');
  });
});
