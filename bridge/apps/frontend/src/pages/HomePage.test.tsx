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

  it('has nothing marked unbuilt right now — RAG graduated to a real page, same as Lab did before it', () => {
    renderHome();

    expect(screen.queryAllByText('скоро')).toHaveLength(0);
    expect(screen.getByRole('link', { name: /RAG/ })).toHaveAttribute('href', '/rag');
    expect(screen.getByRole('link', { name: /RAG/ })).not.toHaveTextContent('скоро');
    expect(screen.getByRole('link', { name: /Lab/ })).toHaveAttribute('href', '/lab');
  });
});
