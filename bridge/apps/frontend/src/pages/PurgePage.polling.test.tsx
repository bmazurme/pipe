import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';

import { PurgePage } from './PurgePage';
import { store } from '../store';
import { draftTextChanged } from '../store/slices';

let visibility: DocumentVisibilityState = 'visible';

function draftCalls(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(
    ([req]) => (req as Request).url.includes('purge/draft/text') && (req as Request).method === 'GET',
  ).length;
}

describe('PurgePage draft polling', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ text: '' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    store.dispatch(draftTextChanged(''));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });


  it('does not poll while hidden, refetches once on becoming visible, then resumes', async () => {
    // fake timers are installed only after mount; re-mount effects under them
    render(<div />).unmount();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    visibility = 'hidden';
    render(
      <Provider store={store}>
        <ThemeProvider theme="light">
          <MemoryRouter>
            <PurgePage />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>,
    );
    await vi.waitFor(() => expect(draftCalls(fetchMock)).toBe(1), { timeout: 2000 });
    await act(async () => {});
    const base = draftCalls(fetchMock);

    await act(async () => {
      vi.advanceTimersByTime(12000);
    });
    expect(draftCalls(fetchMock)).toBe(base);

    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await vi.waitFor(() => expect(draftCalls(fetchMock)).toBe(base + 1), { timeout: 2000 });

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    await vi.waitFor(() => expect(draftCalls(fetchMock)).toBe(base + 2), { timeout: 2000 });
  });
});
