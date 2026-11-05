import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';

import { RagPage } from './RagPage';
import { store } from '../store';
import { labApi } from '../store/api';

type Sent = { path: string; method: string; body: unknown };
let sent: Sent[];
let projects: unknown[];
let knowledgeStatus: { files: number; chunks: number };
let askResult: unknown[];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sent = [];
  projects = [
    { id: 1, name: 'Катер', repo: 'me/boat', baseBranch: 'main', tokenHint: 'abcd', checkedAt: null, canWrite: true },
    { id: 2, name: 'Самолёт', repo: 'me/plane', baseBranch: 'main', tokenHint: 'efgh', checkedAt: null, canWrite: true },
  ];
  knowledgeStatus = { files: 0, chunks: 0 };
  askResult = [];
  store.dispatch(labApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');
      const body = request.method === 'GET' ? undefined : await request.json().catch(() => undefined);

      sent.push({ path, method: request.method, body });

      if (request.method !== 'GET') {
        if (/^lab\/projects\/\d+\/knowledge\/reindex$/.test(path)) {
          knowledgeStatus = { files: 2, chunks: 5 };

          return json(knowledgeStatus);
        }
        if (/^lab\/projects\/\d+\/knowledge\/ask$/.test(path)) return json(askResult);

        return json({ id: 9 });
      }
      if (path === 'lab/projects') return json(projects);
      if (/^lab\/projects\/\d+\/knowledge$/.test(path)) return json(knowledgeStatus);

      return json([]);
    }),
  );
});

function renderPage(initial = '/rag') {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter initialEntries={[initial]}>
          <RagPage />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );
}

describe('RagPage', () => {
  it('nudges to connect a project when there are none', async () => {
    projects = [];
    renderPage();

    expect(await screen.findByText('Нечего искать')).toBeInTheDocument();
    expect(screen.queryByLabelText('Вопрос')).toBeNull();
  });

  it('defaults to the first project when none is chosen in the URL', async () => {
    renderPage();

    await waitFor(() => expect(sent.find((call) => call.path === 'lab/projects/1/knowledge')).toBeDefined());
    expect(await screen.findByText('Катер (me/boat)')).toBeInTheDocument();
  });

  it('pre-selects the project named in ?project=, not just the first one', async () => {
    renderPage('/rag?project=2');

    await waitFor(() => expect(sent.find((call) => call.path === 'lab/projects/2/knowledge')).toBeDefined());
    expect(await screen.findByText('Самолёт (me/plane)')).toBeInTheDocument();
  });

  it('falls back to the first project when ?project= names one that does not exist', async () => {
    renderPage('/rag?project=999');

    expect(await screen.findByText('Катер (me/boat)')).toBeInTheDocument();
  });

  it('shows the indexed file/chunk count, and a nudge to reindex when there is none yet', async () => {
    renderPage();

    expect(await screen.findByText('Пока ничего не проиндексировано — нажмите «Переиндексировать».')).toBeInTheDocument();
  });

  it('reindexes on demand and refreshes the status', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Катер (me/boat)');

    await user.click(screen.getByRole('button', { name: 'Переиндексировать' }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'lab/projects/1/knowledge/reindex', body: undefined }));
    expect(await screen.findByText('Проиндексировано: 2 файлов, 5 фрагментов')).toBeInTheDocument();
  });

  it('asks a question and shows the matched excerpts with their file and heading', async () => {
    askResult = [{ path: 'DECISIONS.md', heading: 'D-048', content: 'Этап 0 закрыт как ненужный.', score: 0.8 }];
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Катер (me/boat)');

    await user.type(screen.getByLabelText('Вопрос'), 'этап 0');
    await user.click(screen.getByRole('button', { name: 'Спросить' }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'lab/projects/1/knowledge/ask', body: { question: 'этап 0' } }));
    expect(await screen.findByText('DECISIONS.md · D-048')).toBeInTheDocument();
    expect(screen.getByText('Этап 0 закрыт как ненужный.')).toBeInTheDocument();
  });

  it('shows no-match text when the question finds nothing', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Катер (me/boat)');

    await user.type(screen.getByLabelText('Вопрос'), 'что-то совсем другое');
    await user.click(screen.getByRole('button', { name: 'Спросить' }));

    expect(await screen.findByText('Ничего не найдено — попробуйте другие слова.')).toBeInTheDocument();
  });

  it('disables "Спросить" while the question is empty', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Катер (me/boat)');

    expect((screen.getByRole('button', { name: 'Спросить' }) as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByLabelText('Вопрос'), 'x');
    expect((screen.getByRole('button', { name: 'Спросить' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('switching the project clears the previous question and results', async () => {
    askResult = [{ path: 'DECISIONS.md', heading: null, content: 'Про корпус.', score: 0.5 }];
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Катер (me/boat)');

    await user.type(screen.getByLabelText('Вопрос'), 'корпус');
    await user.click(screen.getByRole('button', { name: 'Спросить' }));
    expect(await screen.findByText('Про корпус.')).toBeInTheDocument();

    await user.click(screen.getByText('Катер (me/boat)'));
    await user.click(await screen.findByText('Самолёт (me/plane)'));

    expect(screen.queryByText('Про корпус.')).toBeNull();
    expect((screen.getByLabelText('Вопрос') as HTMLInputElement).value).toBe('');
  });
});
