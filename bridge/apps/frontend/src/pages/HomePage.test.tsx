import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import { HomePage } from './HomePage';
import { SERVICES } from '../shared/config/services';
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

  it('does not point at a sidebar — there is none on mobile', () => {
    renderHome();

    expect(screen.queryByText(/слева/)).toBeNull();
  });

  it('lists unbuilt services without making them look openable', () => {
    renderHome();

    expect(screen.getByText('скоро')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /RAG/ })).toBeNull();
  });
});
