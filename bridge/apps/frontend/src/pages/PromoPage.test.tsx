import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PromoPage } from './PromoPage';
import { store } from '../store';
import { promoApi } from '../store/api';

type Sent = { method: string; path: string; body: unknown };
let sent: Sent[];
let posts: Record<string, unknown>[];
let assets: Record<string, unknown>[];
let landing: Record<string, unknown>;
let failWith: { path: RegExp; message: string } | null;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const post = (over: Record<string, unknown> = {}) => ({
  id: 1,
  channel: 'telegram',
  title: 'Самопереворот',
  textRu: 'Лодка встаёт на киль',
  textEn: 'It rights itself',
  assetIds: [],
  mode: 'auto',
  scheduledAt: null,
  status: 'draft',
  externalUrl: null,
  error: null,
  publishedAt: null,
  utmCampaign: null,
  captionLength: 40,
  captionLimit: 4096,
  createdAt: iso(0),
  updatedAt: iso(0),
  ...over,
});

const counts = (over: Record<string, number> = {}) => ({ draft: 0, approved: 0, published: 0, reminded: 0, failed: 0, ...over });

const release = (over: Record<string, unknown> = {}) => ({
  id: 1,
  label: 'Первая',
  dirName: 'r20261114080000-aaaa1111',
  fileCount: 12,
  sizeBytes: 2048,
  createdAt: iso(-86_400_000),
  activatedAt: null,
  active: false,
  ...over,
});

beforeEach(() => {
  sent = [];
  posts = [post()];
  assets = [];
  failWith = null;
  landing = { configured: true, url: 'https://landing.example', activeDirName: null, releases: [] };
  store.dispatch(promoApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      if (request.method !== 'GET') {
        const contentType = request.headers.get('content-type') ?? '';
        const body = contentType.includes('json') ? await request.clone().json() : contentType.includes('multipart') ? 'multipart' : null;

        sent.push({ method: request.method, path, body });

        if (failWith && failWith.path.test(path)) return json({ message: failWith.message }, 400);

        return request.method === 'DELETE' ? new Response(null, { status: 204 }) : json(post({ ...(body as object), status: path.endsWith('/approve') ? 'approved' : 'draft' }));
      }

      if (path === 'promo/overview') {
        return json({
          channels: [
            { channel: 'telegram', autoPublish: false, ready: true, note: 'Готов; автопубликация появится на следующем этапе', counts: counts({ draft: 2, published: 1 }), next: null },
            { channel: 'youtube', autoPublish: false, ready: false, note: 'Пока только напоминания; автопубликация после аудита API', counts: counts(), next: null },
            { channel: 'instagram', autoPublish: false, ready: false, note: 'Пока только напоминания; автопубликация после аудита API', counts: counts(), next: null },
          ],
          landing: { configured: true, url: 'https://landing.example', activeDirName: 'legacy', releases: 0 },
        });
      }

      if (path === 'promo/posts') return json(posts);
      if (path === 'promo/assets') return json(assets);
      if (path === 'promo/landing') return json(landing);

      return json({});
    }),
  );
});

const renderPage = (tab?: string) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter initialEntries={[tab ? `/promo?tab=${tab}` : '/promo']}>
          <PromoPage />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );

describe('PromoPage: overview', () => {
  it('shows each channel with whether it is ready and what is in the queue, and the landing', async () => {
    renderPage();

    expect(await screen.findByText('Telegram')).toBeTruthy();
    expect(screen.getByText('YouTube')).toBeTruthy();
    expect(screen.getByText('Instagram')).toBeTruthy();
    expect(screen.getByText('черновиков 2, согласовано 0, опубликовано 1')).toBeTruthy();
    expect(screen.getAllByText('не настроен').length).toBeGreaterThanOrEqual(2);
    // the tab and the card
    expect(screen.getAllByText('Лендинг')).toHaveLength(2);
    expect(screen.getByText(/Сейчас: legacy/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Открыть сайт' }).getAttribute('href')).toBe('https://landing.example');
  });

  it('warns about a failed post and an approved one whose time has passed', async () => {
    posts = [
      post({ id: 1, title: 'Упавший', status: 'failed', error: 'Telegram не ответил' }),
      post({ id: 2, title: 'Просроченный', status: 'approved', scheduledAt: iso(-3_600_000) }),
      post({ id: 3, title: 'Будущий', status: 'approved', scheduledAt: iso(3_600_000) }),
    ];
    renderPage();

    expect(await screen.findByText('Требует внимания: 2')).toBeTruthy();
    expect(screen.getByText(/Упавший — ошибка: Telegram не ответил/)).toBeTruthy();
    expect(screen.getByText(/Просроченный — время прошло/)).toBeTruthy();
    // the future one is in the list of coming posts, not among the problems
    expect(await screen.findByText('Будущий')).toBeTruthy();
  });
});

describe('PromoPage: posts', () => {
  it('lists the posts with the length against the limit', async () => {
    renderPage('posts');

    expect(await screen.findByText('Самопереворот')).toBeTruthy();
    expect(screen.getByText(/40 \/ 4096 знаков/)).toBeTruthy();
    expect(screen.getByText('черновик')).toBeTruthy();
  });

  it('creates a post from the dialog and counts the caption while typing', async () => {
    const user = userEvent.setup();
    renderPage('posts');

    await user.click(await screen.findByRole('button', { name: /Новый пост/ }));
    await user.type(screen.getByLabelText('Название'), 'Новый');
    await user.type(screen.getByLabelText('Текст (русский)'), 'Привет');
    await user.type(screen.getByLabelText('Абзац на английском'), 'Hello');

    // «Привет» + blank line + «Hello»
    expect(screen.getByText(/13 \/ 4096 знаков/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent.find((s) => s.method === 'POST' && s.path === 'promo/posts')).toBeTruthy());
    expect(sent.find((s) => s.path === 'promo/posts')?.body).toMatchObject({
      channel: 'telegram',
      title: 'Новый',
      textRu: 'Привет',
      textEn: 'Hello',
      mode: 'auto',
      scheduledAt: null,
    });
  });

  it('approves a draft, and shows the refusal of the server', async () => {
    const user = userEvent.setup();
    renderPage('posts');

    await user.click(await screen.findByRole('button', { name: 'Согласовать' }));
    await waitFor(() => expect(sent).toContainEqual(expect.objectContaining({ method: 'POST', path: 'promo/posts/1/approve' })));

    failWith = { path: /approve$/, message: 'Текст длиннее лимита: 1200 из 1024 знаков' };
    await user.click(await screen.findByRole('button', { name: 'Согласовать' }));

    expect(await screen.findByText(/Текст длиннее лимита: 1200 из 1024/)).toBeTruthy();
  });

  it('marks a post as published with the link', async () => {
    const user = userEvent.setup();
    renderPage('posts');

    await user.click(await screen.findByRole('button', { name: 'Отметить опубликованным' }));
    await user.type(screen.getByLabelText('Ссылка на пост'), 'https://t.me/c/1/2');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Отметить' }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'promo/posts/1/published', body: { externalUrl: 'https://t.me/c/1/2' } }));
  });

  it('asks before deleting a post', async () => {
    const user = userEvent.setup();
    renderPage('posts');

    await user.click(await screen.findByRole('button', { name: 'Удалить' }));
    expect(sent).toEqual([]);

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(sent).toContainEqual(expect.objectContaining({ method: 'DELETE', path: 'promo/posts/1' })));
  });

  it('does not offer edit or approve for a post that is already out', async () => {
    posts = [post({ status: 'published' })];
    renderPage('posts');

    expect(await screen.findByText('опубликован')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Редактировать' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Согласовать' })).toBeNull();
  });
});

describe('PromoPage: assets', () => {
  it('uploads a file', async () => {
    const user = userEvent.setup();
    renderPage('assets');

    expect(await screen.findByText('Файлов нет')).toBeTruthy();
    await user.upload(screen.getByLabelText('Выбрать файл'), new File(['x'], 'reel.mp4', { type: 'video/mp4' }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'promo/assets', body: 'multipart' }));
  });

  it('lists the files with their size', async () => {
    assets = [{ id: 7, originalName: 'N4_turn_flip.mp4', mime: 'video/mp4', size: 6_571_219, createdAt: iso(0) }];
    renderPage('assets');

    expect(await screen.findByText('N4_turn_flip.mp4')).toBeTruthy();
    expect(screen.getByText(/video\/mp4 · 6\.3 МБ/)).toBeTruthy();
  });
});

describe('PromoPage: landing', () => {
  it('says so when the volume is not mounted (a dev machine)', async () => {
    landing = { configured: false, url: null, activeDirName: null, releases: [] };
    renderPage('landing');

    expect(await screen.findByText('Лендинг не настроен')).toBeTruthy();
  });

  it('shows the live release, switches to another, and does not offer to delete the live one', async () => {
    const user = userEvent.setup();
    landing = {
      configured: true,
      url: 'https://landing.example',
      activeDirName: 'r2',
      releases: [release({ id: 2, label: 'Вторая', dirName: 'r2', active: true, activatedAt: iso(0) }), release({ id: 1 })],
    };
    renderPage('landing');

    expect(await screen.findByText('Вторая')).toBeTruthy();
    expect(screen.getByText('на сайте')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Включить' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Удалить' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Включить' }));
    await waitFor(() => expect(sent).toContainEqual(expect.objectContaining({ method: 'POST', path: 'promo/landing/releases/1/activate' })));
  });

  it('mentions a live release that did not come through bridge', async () => {
    landing = { configured: true, url: null, activeDirName: 'script-20261114', releases: [release()] };
    renderPage('landing');

    expect(await screen.findByText(/Сейчас на сайте script-20261114/)).toBeTruthy();
  });

  it('uploads a zip and shows the refusal of the server', async () => {
    const user = userEvent.setup();
    renderPage('landing');

    await screen.findByText('Релизов нет');
    failWith = { path: /landing\/releases$/, message: 'В корне архива нет index.html' };
    await user.upload(screen.getByLabelText('Выбрать архив'), new File(['x'], 'site.zip', { type: 'application/zip' }));

    expect(await screen.findByText('В корне архива нет index.html')).toBeTruthy();
    expect(sent).toContainEqual({ method: 'POST', path: 'promo/landing/releases', body: 'multipart' });
  });
});
