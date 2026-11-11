import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import { HomePage } from './HomePage';
import { NAV_GROUP_ORDER, NAV_GROUP_TITLES, SERVICES } from '../shared/config/services';
import { store } from '../store';

function renderHome() {
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </Provider>,
  );
}

describe('HomePage', () => {
  it('links to every service, so the landing page is not a dead end', () => {
    renderHome();

    for (const service of SERVICES) {
      const link = screen.getByRole('link', { name: new RegExp(service.title) });
      expect(link).toHaveAttribute('href', service.path);
    }

    expect(screen.getByRole('link', { name: /Профиль/ })).toHaveAttribute(
      'href',
      '/profile',
    );
  });

  it('groups the cards into the sidebar sections, each under its own heading and in the sidebar order', () => {
    renderHome();

    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent ?? '');

    expect(headings.slice(0, NAV_GROUP_ORDER.length).map((text) => text.replace(/\d+$/, ''))).toEqual(NAV_GROUP_ORDER.map((group) => NAV_GROUP_TITLES[group]));
    expect(headings.at(-1)).toBe('Аккаунт');

    const agent = screen.getByRole('region', { name: new RegExp(NAV_GROUP_TITLES.agent) });

    expect(within(agent).getByRole('link', { name: /Chat/ })).toBeInTheDocument();
    expect(within(agent).queryByRole('link', { name: /Storage/ })).toBeNull();
  });

  it('does not point at a sidebar — there is none on mobile', () => {
    renderHome();

    expect(screen.queryByText(/слева/)).toBeNull();
  });

  it('has nothing marked unbuilt right now — RAG graduated to a real page, same as Lab did before it', () => {
    renderHome();

    expect(screen.queryAllByText('скоро')).toHaveLength(0);
    expect(screen.getByRole('link', { name: /RAG/ })).toHaveAttribute('href', '/rag');
    expect(screen.getByRole('link', { name: /RAG/ })).not.toHaveTextContent('скоро');
    expect(screen.getByRole('link', { name: /Lab/ })).toHaveAttribute('href', '/lab');
  });
});
