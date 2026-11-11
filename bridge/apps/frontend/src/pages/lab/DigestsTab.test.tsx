import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { DigestsTab } from './DigestsTab';
import { store } from '../../store';
import { labApi, workerApi } from '../../store/api';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ITEM = {
  source: 'lab',
  id: 5,
  title: 'Обновить зависимости',
  repo: 'bmazurme/pipe',
  status: 'pr_open',
  url: 'https://github.com/bmazurme/pipe/pull/9',
  finishedAt: '2026-11-03T09:00:00.000Z',
  jobId: 70,
  model: 'haiku',
  costUsd: 0.5,
};

const digest = (over: Record<string, unknown> = {}) => ({
  id: 1,
  weekStart: '2026-11-02',
  status: 'draft',
  includePrivate: false,
  model: 'haiku',
  jobId: 99,
  items: [ITEM],
  excludedPrivate: 2,
  title: 'Неделя 2–8 ноября',
  preview: 'Коротко о неделе.',
  content: '## Итоги\n\nСделана одна работа: https://github.com/bmazurme/pipe/pull/9',
  tags: ['lab'],
  noteType: 'Dev Work Diary',
  error: null,
  noteId: null,
  sentAt: null,
  exportedAt: null,
  finishedAt: '2026-11-09T04:00:00.000Z',
  createdAt: '2026-11-09T03:59:00.000Z',
  updatedAt: '2026-11-09T04:00:00.000Z',
  ...over,
});

let sent: { method: string; path: string; body: unknown }[];
let digests: unknown[];
let preview: unknown;
let startReply: () => Response;
let settings: Record<string, unknown>;

beforeEach(() => {
  sent = [];
  digests = [digest()];
  preview = { weekStart: '2026-11-02', items: [ITEM], omitted: 0, excludedPrivate: 2 };
  settings = { autoWeekly: false, includePrivate: false, model: 'haiku', notesUrl: 'https://notes.ntlstl.dev', hasNotesKey: false, notesKeyHint: null };
  startReply = () => json(digest({ status: 'generating', title: null, content: null }));
  store.dispatch(labApi.util.resetApiState());
  store.dispatch(workerApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      const path = url.pathname.replace('/api/v1/', '');

      if (request.method !== 'GET') sent.push({ method: request.method, path, body: await request.clone().json().catch(() => undefined) });
      if (path === 'lab/digests/settings') return request.method === 'PUT' ? json(settings) : json(settings);
      if (path === 'lab/digests/preview') return json(preview);
      if (path === 'lab/digests' && request.method === 'POST') return startReply();
      if (path === 'lab/digests') return json(digests);
      if (path.startsWith('lab/digests/')) return json(digest());
      if (path === 'worker/provider-credentials') return json([]);

      return json([]);
    }),
  );
});

const renderTab = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <DigestsTab />
      </ThemeProvider>
    </Provider>,
  );

describe('DigestsTab', () => {
  it('opens the latest draft in an editor and says how much private work was left out', async () => {
    renderTab();

    expect(await screen.findByDisplayValue('Неделя 2–8 ноября')).toBeTruthy();
    expect(screen.getByLabelText('Текст заметки')).toHaveValue(digest().content);
    expect(screen.getByLabelText('Теги')).toHaveValue('lab');
    expect(await screen.findByText(/скрыто приватных: 2/)).toBeTruthy();
    expect(screen.getByText(/Черновик хранится в bridge/)).toBeTruthy();
  });

  it('shows what would go into the digest of the chosen week before anything starts', async () => {
    renderTab();

    expect(await screen.findByText(/Завершённых работ в дайджесте: 1/)).toBeTruthy();
    expect(sent.filter((call) => call.path === 'lab/digests')).toEqual([]);
  });

  it('starts a digest for the week and cannot when the week is empty', async () => {
    renderTab();

    await userEvent.click(await screen.findByRole('button', { name: 'Собрать' }));

    await waitFor(() => expect(sent.find((call) => call.path === 'lab/digests')?.body).toEqual({ weekStart: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
  });

  it('refuses to start when the week has nothing', async () => {
    preview = { weekStart: '2026-11-02', items: [], omitted: 0, excludedPrivate: 3 };

    renderTab();

    expect(await screen.findByText(/В публичных репозиториях работы нет/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Собрать' })).toBeDisabled();
  });

  it('saves the corrected note with tidy tags', async () => {
    renderTab();

    const title = await screen.findByDisplayValue('Неделя 2–8 ноября');

    await userEvent.clear(title);
    await userEvent.type(title, 'Другой заголовок');
    await userEvent.clear(screen.getByLabelText('Теги'));
    await userEvent.type(screen.getByLabelText('Теги'), 'Lab, #Diary');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => {
      const call = sent.find((entry) => entry.method === 'PATCH');

      expect(call?.path).toBe('lab/digests/1');
      expect(call?.body).toMatchObject({ title: 'Другой заголовок', tags: ['lab', 'diary'] });
    });
  });

  it('warns about values that look real, but not about links to GitHub', async () => {
    digests = [digest({ content: 'Сервер 10.20.30.40 и ссылка https://github.com/bmazurme/pipe/pull/9' })];

    renderTab();

    expect(await screen.findByText(/Похоже на реальные данные/)).toBeTruthy();
    expect(screen.getByText(/ip — 10\.20\.30\.40/)).toBeTruthy();
    expect(screen.queryByText(/hostname — github\.com/)).toBeNull();
  });

  it('marks the note as carried over only after it was saved', async () => {
    renderTab();

    await userEvent.click(await screen.findByRole('button', { name: 'Перенёс в notes сам' }));

    await waitFor(() => expect(sent.find((call) => call.path === 'lab/digests/1/exported')?.method).toBe('POST'));
  });

  it('shows why a digest failed and offers to try again', async () => {
    digests = [digest({ status: 'failed', title: null, content: null, error: 'Worker не создал digest.json' })];

    renderTab();

    await userEvent.click(await screen.findByRole('button', { name: 'Открыть' }));
    expect(await screen.findByText('Worker не создал digest.json')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('cannot send to the site until a key is saved, and says why', async () => {
    renderTab();

    const send = await screen.findByRole('button', { name: 'Отправить в notes' });

    expect(send).toBeDisabled();
    expect(send).toHaveAttribute('title', expect.stringContaining('сохраните ключ'));
  });

  it('sends the draft to the site once a key is stored', async () => {
    settings = { ...settings, hasNotesKey: true, notesKeyHint: 'abcd' };

    renderTab();

    const send = await screen.findByRole('button', { name: 'Отправить в notes' });

    await waitFor(() => expect(send).toBeEnabled());
    await userEvent.click(send);

    await waitFor(() => expect(sent.find((call) => call.path === 'lab/digests/1/send')?.method).toBe('POST'));
  });

  it('shows where a sent draft went and offers no second send', async () => {
    digests = [digest({ status: 'exported', noteId: 42, sentAt: '2026-11-12T01:00:00.000Z' })];

    renderTab();

    expect(await screen.findByText(/заметка № 42/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Отправить в notes' })).toBeNull();
  });

  it('saves the key from its field and never shows a stored one', async () => {
    settings = { ...settings, hasNotesKey: true, notesKeyHint: 'abcd' };

    renderTab();

    const field = await screen.findByLabelText('Ключ сайта заметок');

    expect(field).toHaveAttribute('placeholder', 'сохранён …abcd');
    expect(field).toHaveValue('');

    await userEvent.type(field, 'k'.repeat(40));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить ключ' }));

    await waitFor(() => expect(sent.find((call) => call.method === 'PUT')?.body).toEqual({ notesKey: 'k'.repeat(40) }));
    await waitFor(() => expect(field).toHaveValue(''));
  });
});
