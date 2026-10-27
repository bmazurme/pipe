import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { ProjectsTab } from './ProjectsTab';
import { store } from '../../store';
import { labApi } from '../../store/api';

const DAY = 24 * 60 * 60 * 1000;

const project = (tokenExpiresAt: string | null) => ({
  id: 1,
  name: 'Лодка',
  repo: 'me/boat',
  baseBranch: 'main',
  tokenHint: 'ABCD',
  checkedAt: null,
  tokenExpiresAt,
  canWrite: true,
});

function renderWith(tokenExpiresAt: string | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify([project(tokenExpiresAt)]), { status: 200, headers: { 'content-type': 'application/json' } }))),
  );

  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ProjectsTab />
      </ThemeProvider>
    </Provider>,
  );
}

beforeEach(() => {
  store.dispatch(labApi.util.resetApiState());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProjectsTab token expiry', () => {
  it('shows the date and a warning 3 days before expiry', async () => {
    const date = new Date(Date.now() + 3 * DAY - 60_000);

    renderWith(date.toISOString());

    expect(await screen.findByText(/токен до \d{2}\.\d{2}\.\d{4}/)).toBeInTheDocument();
    expect(screen.getByText('истекает через 3 дн.')).toBeInTheDocument();
  });

  it('shows no warning while more than a week remains', async () => {
    renderWith(new Date(Date.now() + 30 * DAY).toISOString());

    expect(await screen.findByText(/токен до/)).toBeInTheDocument();
    expect(screen.queryByText(/истекает через/)).not.toBeInTheDocument();
  });

  it('says the token expired once past', async () => {
    renderWith(new Date(Date.now() - DAY).toISOString());

    expect(await screen.findByText('токен истёк')).toBeInTheDocument();
  });

  it('shows nothing for a token without expiry', async () => {
    renderWith(null);

    expect(await screen.findByText(/me\/boat/)).toBeInTheDocument();
    expect(screen.queryByText(/токен до/)).not.toBeInTheDocument();
    expect(screen.queryByText(/истекает через|токен истёк/)).not.toBeInTheDocument();
  });
});
