import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { TasksPage } from './TasksPage';
import { store } from '../../store';
import { tasksApi } from '../../store/api';

const BOARD = {
  columns: [
    {
      id: 1,
      title: 'Todo',
      position: 0,
      cards: [{ id: 10, columnId: 1, title: 'Write docs', description: 'Short text', position: 0, archivedAt: null }],
    },
    { id: 2, title: 'Done', position: 1, cards: [] },
  ],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderPage() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <TasksPage />
      </ThemeProvider>
    </Provider>,
  );
}

beforeEach(() => {
  store.dispatch(tasksApi.util.resetApiState());
});

describe('TasksPage', () => {
  it('shows columns with their cards (title and description only)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(BOARD)));
    renderPage();

    expect(await screen.findByText('Write docs')).toBeTruthy();
    expect(screen.getByText('Short text')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('adds a column', async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      if (request.method === 'POST') return json({ id: 3, title: 'Review', position: 2, cards: [] }, 201);
      return json(BOARD);
    });

    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText('Write docs');

    await userEvent.type(screen.getByLabelText('Название новой колонки'), 'Review');
    await userEvent.click(screen.getByRole('button', { name: 'Добавить колонку' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.map((c) => c[0] as Request).find((r) => r.method === 'POST');

      expect(post?.url).toContain('/tasks/columns');
    });
  });

  it('archives a card', async () => {
    const fetchMock = vi.fn(async (request: Request) => (request.method === 'PATCH' ? json({}) : json(BOARD)));

    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText('Write docs');

    await userEvent.click(screen.getByRole('button', { name: 'В архив' }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.map((c) => c[0] as Request).find((r) => r.method === 'PATCH');

      expect(patch?.url).toContain('/tasks/cards/10');
    });
  });

  it('keeps the column highlighted while a dragged card moves over its own children, and drops it once the pointer is outside', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(BOARD)));
    renderPage();
    await screen.findByText('Write docs');

    const card = screen.getByTestId('task-card-10');
    const column = screen.getByLabelText('Колонка Done');
    const highlighted = () => /columnOver/.test(column.className);

    column.getBoundingClientRect = () => ({ left: 100, right: 380, top: 50, bottom: 400, width: 280, height: 350, x: 100, y: 50, toJSON: () => ({}) });
    fireEvent.dragStart(card, { dataTransfer: { setData: () => undefined, effectAllowed: '' } });
    fireEvent.dragOver(column);
    expect(highlighted()).toBe(true);

    // The pointer goes from the column onto a child of it: dragleave fires with the pointer still inside the column.
    fireEvent(column, Object.assign(createEvent.dragLeave(column), { clientX: 200, clientY: 200 }));
    expect(highlighted()).toBe(true);

    // Really leaving ends it.
    fireEvent(column, Object.assign(createEvent.dragLeave(column), { clientX: 500, clientY: 200 }));
    expect(highlighted()).toBe(false);

    // A cancelled drag (no drop, no dragleave on this column) must not leave it lit.
    fireEvent.dragOver(column);
    expect(highlighted()).toBe(true);
    fireEvent.dragEnd(card);
    await waitFor(() => expect(highlighted()).toBe(false));
  });
});
