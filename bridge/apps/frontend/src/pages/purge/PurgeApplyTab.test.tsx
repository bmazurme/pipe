import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { PurgeApplyTab } from './PurgeApplyTab';
import { store } from '../../store';
import { draftTextChanged } from '../../store/slices';

const ENTRIES = [
  { id: 1, key: 'Иванов', value: 'Клиент А' },
  { id: 2, key: 'Петров', value: 'Клиент Б' },
];

function renderTab() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <PurgeApplyTab onGoToDictionary={() => {}} />
      </ThemeProvider>
    </Provider>,
  );
}

function textarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText('Вставьте текст');
}

// fetchBaseQuery calls the global fetch as fetch(new Request(url, init)) — a
// single Request object, not fetch(url, init) — so a mock keyed off a
// second `init` argument never sees the real method/body. Reading them off
// the Request itself (cloned, since .text() consumes the body stream once)
// is what actually works here.
async function mockRequestMethodAndBody(request: Request): Promise<{ method: string; body: unknown }> {
  const method = request.method;
  const text = await request.clone().text();
  return { method, body: text ? JSON.parse(text) : undefined };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(ENTRIES), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  store.dispatch(draftTextChanged(''));
});

describe('PurgeApplyTab', () => {
  it('places both actions above the text field', async () => {
    renderTab();
    await screen.findByRole('button', { name: 'Сохранить' });

    const save = screen.getByRole('button', { name: 'Сохранить' });
    const copy = screen.getByRole('button', { name: /Копировать/ });

    // Node.compareDocumentPosition: FOLLOWING means the field comes after.
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(save.compareDocumentPosition(textarea()) & FOLLOWING).toBeTruthy();
    expect(copy.compareDocumentPosition(textarea()) & FOLLOWING).toBeTruthy();
  });

  it('replaces dictionary keys in the field and reports the count', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('button', { name: 'Сохранить' });

    await user.type(textarea(), 'Иванов и Петров');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(textarea().value).toBe('Клиент А и Клиент Б');
    expect(screen.getByText('Заменено слов: 2')).toBeTruthy();
  });

  it('keeps the actions disabled, with a reason, until there is text', async () => {
    renderTab();
    await screen.findByRole('button', { name: 'Сохранить' });

    const save = screen.getByRole('button', { name: 'Сохранить' });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('title', 'Вставьте текст в поле ниже');
  });

  it('clears the field only after the clipboard write succeeds', async () => {
    // userEvent.setup() installs its own navigator.clipboard stub, so ours
    // has to land after it or it gets overwritten.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    renderTab();
    await screen.findByRole('button', { name: 'Сохранить' });

    await user.type(textarea(), 'Иванов');
    await user.click(screen.getByRole('button', { name: /Копировать/ }));

    await waitFor(() => expect(textarea().value).toBe(''));
    expect(writeText).toHaveBeenCalledWith('Иванов');
  });

  it('warns when the result still looks like it contains a real secret', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('button', { name: 'Сохранить' });

    await user.type(textarea(), 'contact oncall@acme-corp.example about Иванов');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(textarea().value).toBe('contact oncall@acme-corp.example about Клиент А');
    expect(await screen.findByText(/анонимизация неполная/i)).toBeTruthy();
    // Scoped to the finding's own list item — the raw address also shows up
    // in the textarea's auto-resize measuring node, so a bare substring match
    // finds two elements.
    expect(screen.getByText('email: oncall@acme-corp.example')).toBeTruthy();
  });

  it('does not warn once the result is clean', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('button', { name: 'Сохранить' });

    await user.type(textarea(), 'Иванов и Петров');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(screen.queryByText(/анонимизация неполная/i)).toBeNull();
  });

  it('clears the warning once the text is edited again', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('button', { name: 'Сохранить' });

    await user.type(textarea(), 'contact oncall@acme-corp.example');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await screen.findByText(/анонимизация неполная/i);

    await user.type(textarea(), '!');

    expect(screen.queryByText(/анонимизация неполная/i)).toBeNull();
  });

  it('adds a leak-scan finding to the dictionary with an auto-generated value', async () => {
    const user = userEvent.setup();
    let postBody: { key: string; value: string } | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const { method, body } = await mockRequestMethodAndBody(request);
        if (method === 'POST') {
          postBody = body as { key: string; value: string };
          return new Response(JSON.stringify({ id: 3, ...postBody, createdAt: new Date().toISOString() }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(ENTRIES), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );

    renderTab();
    await screen.findByRole('button', { name: 'Сохранить' });

    // A single high-entropy token — unlike an email, this matches exactly
    // one leak-scan pattern (kind: 'token'), so there's exactly one row.
    const secret = 'sk_live_9fJ3kLp0Qz7Xw2Bv8Yc1Nm4RtGh6Ae5D';
    await user.type(textarea(), `key: ${secret}`);
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await screen.findByText(`token: ${secret}`);

    await user.click(screen.getByRole('button', { name: 'В словарь' }));

    // The only finding was resolved — the whole warning clears, not just that row.
    await waitFor(() => expect(screen.queryByText(/анонимизация неполная/i)).toBeNull());
    expect(postBody?.key).toBe(secret);
    expect(postBody?.value).toHaveLength(secret.length);
    expect(postBody?.value).not.toBe(secret);
  });

  it('shows an inline error on a duplicate key without clearing the other findings', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const { method } = await mockRequestMethodAndBody(request);
        if (method === 'POST') {
          return new Response(JSON.stringify({ message: 'Key "oncall@acme-corp.example" already exists' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(ENTRIES), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );

    renderTab();
    await screen.findByRole('button', { name: 'Сохранить' });

    await user.type(textarea(), 'contact oncall@acme-corp.example and prod-db.internal.example.ru');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await screen.findByText('email: oncall@acme-corp.example');

    await user.click(screen.getAllByRole('button', { name: 'В словарь' })[0]);

    expect(await screen.findByText('Такой ключ уже есть в словаре')).toBeTruthy();
    // Neither finding was removed — the failed one is still there to retry,
    // and the unrelated one wasn't touched.
    expect(screen.getByText('email: oncall@acme-corp.example')).toBeTruthy();
    expect(screen.getByText('hostname: prod-db.internal.example.ru')).toBeTruthy();
  });

  it('surfaces a failed copy as an error and keeps the text', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });

    renderTab();
    await screen.findByRole('button', { name: 'Сохранить' });

    await user.type(textarea(), 'Иванов');
    await user.click(screen.getByRole('button', { name: /Копировать/ }));

    // A silently-dropped copy that also wiped the field would lose the work.
    expect(await screen.findByText(/Не удалось скопировать/)).toBeTruthy();
    expect(textarea().value).toBe('Иванов');
  });
});
