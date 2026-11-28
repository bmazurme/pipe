import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { improveApi } from '../../store/api';
import { SaveKnowledgeDialog } from './SaveKnowledgeDialog';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let posts: unknown[];
let respond: () => Response;

beforeEach(() => {
  posts = [];
  respond = () => json({ number: 77, url: 'https://github.com/o/r/pull/77', branch: 'knowledge/x', path: 'CLAUDE.md' }, 201);
  store.dispatch(improveApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      posts.push({ url: new URL(request.url).pathname.replace('/api/v1/', ''), body: await request.json() });

      return respond();
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const onClose = vi.fn();
const renderDialog = (props: Partial<Parameters<typeof SaveKnowledgeDialog>[0]> = {}) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <SaveKnowledgeDialog initialTitle="Порт reports?" initialText="Сервер слушает :4000." source="вопрос 173:628" onClose={onClose} {...props} />
      </ThemeProvider>
    </Provider>,
  );

describe('SaveKnowledgeDialog', () => {
  it('starts from the wording given, and opens a pull request with what was edited and where', async () => {
    const user = userEvent.setup();

    renderDialog();

    const text = screen.getByLabelText('Текст знания');

    await user.clear(text);
    await user.type(text, 'Сервер :4000, клиент :5174.');
    await user.click(screen.getByText('docs/knowledge.md'));
    await user.click(screen.getByRole('button', { name: 'Открыть PR' }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      url: 'improve/knowledge',
      body: { title: 'Порт reports?', text: 'Сервер :4000, клиент :5174.', target: 'docs', source: 'вопрос 173:628' },
    });

    expect(await screen.findByText('Pull request открыт')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'PR #77' }).getAttribute('href')).toBe('https://github.com/o/r/pull/77');
    expect(screen.getByText(/Запись попадёт в репозиторий после слияния/)).toBeTruthy();
  });

  it('refuses to send what looks like a key, and says what was found without showing it', async () => {
    renderDialog({ initialText: 'токен ghp_AbCdEfGhIjKlMnOpQrSt1234' });

    expect(screen.getByText(/токен GitHub \(ghp_\*\*\*\)/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Открыть PR' }) as HTMLButtonElement).disabled).toBe(true);
    expect(posts).toHaveLength(0);
  });

  it('needs a title and a text', async () => {
    const user = userEvent.setup();

    renderDialog();
    await user.clear(screen.getByLabelText('Заголовок знания'));

    expect((screen.getByRole('button', { name: 'Открыть PR' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the server’s refusal and stays open to try again', async () => {
    const user = userEvent.setup();

    respond = () => json({ message: 'Такое знание уже записано' }, 409);
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Открыть PR' }));

    expect(await screen.findByText('Такое знание уже записано')).toBeTruthy();
    expect(screen.queryByText('Pull request открыт')).toBeNull();
  });

  it('warns when a long text was cut to the start', () => {
    renderDialog({ initialText: 'я'.repeat(3500) });

    expect(screen.getByText(/взято начало/)).toBeTruthy();
    expect((screen.getByLabelText('Текст знания') as HTMLTextAreaElement).value).toHaveLength(3000);
  });
});
