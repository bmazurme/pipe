import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';

import { TimePage } from './TimePage';
import { store } from '../store';

function renderAt(entry: string) {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter initialEntries={[entry]}>
          <TimePage />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
});

describe('TimePage', () => {
  it('opens the tab named in the URL, so a reload lands where the user was', async () => {
    renderAt('/time?tab=report');

    expect(await screen.findByRole('button', { name: /Импортировать/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeTruthy();
  });

  it('builds only the active tab', () => {
    renderAt('/time');

    // TabPanel hides inactive panels with CSS but still mounts their
    // children unless the page guards them — the report tab firing its own
    // request here would be the tell.
    expect(screen.getAllByRole('button', { name: 'Следующий год' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Импортировать/ })).toBeNull();
  });

  it('marks the current month and explains the marker', async () => {
    renderAt('/time');

    expect(await screen.findByText('Сейчас')).toBeTruthy();
    expect(screen.getByText('Сегодня')).toBeTruthy();
  });
});
