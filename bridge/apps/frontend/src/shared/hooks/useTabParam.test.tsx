import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { useTabParam } from './useTabParam';

const TABS = ['calendar', 'day-offs', 'report'] as const;

function Harness() {
  const [activeTab, setActiveTab] = useTabParam(TABS, 'calendar');
  const location = useLocation();

  return (
    <div>
      <span data-testid="active">{activeTab}</span>
      <span data-testid="search">{location.search}</span>
      {TABS.map((tab) => (
        <button key={tab} type="button" onClick={() => setActiveTab(tab)}>
          {tab}
        </button>
      ))}
    </div>
  );
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Harness />
    </MemoryRouter>,
  );
}

describe('useTabParam', () => {
  it('falls back to the default tab when the query is absent', () => {
    renderAt('/time');

    expect(screen.getByTestId('active').textContent).toBe('calendar');
  });

  it('restores the tab named in the query — this is what survives a reload', () => {
    renderAt('/time?tab=report');

    expect(screen.getByTestId('active').textContent).toBe('report');
  });

  it('falls back rather than rendering an empty panel for an unknown tab', () => {
    renderAt('/time?tab=nope');

    expect(screen.getByTestId('active').textContent).toBe('calendar');
  });

  it('writes the selected tab into the query', async () => {
    const user = userEvent.setup();
    renderAt('/time');

    await user.click(screen.getByRole('button', { name: 'day-offs' }));

    expect(screen.getByTestId('active').textContent).toBe('day-offs');
    expect(screen.getByTestId('search').textContent).toBe('?tab=day-offs');
  });

  it('keeps the default tab out of the URL so one screen has one address', async () => {
    const user = userEvent.setup();
    renderAt('/time?tab=report');

    await user.click(screen.getByRole('button', { name: 'calendar' }));

    expect(screen.getByTestId('active').textContent).toBe('calendar');
    expect(screen.getByTestId('search').textContent).toBe('');
  });

  it('leaves unrelated query params alone', async () => {
    const user = userEvent.setup();
    renderAt('/time?ref=email');

    await user.click(screen.getByRole('button', { name: 'report' }));

    expect(screen.getByTestId('search').textContent).toBe('?ref=email&tab=report');
  });
});
