import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../sidebar', () => ({ default: () => <nav>sidebar</nav> }));
vi.mock('../update-banner', () => ({ default: () => <div role="status">Доступна новая версия reports</div> }));

import Content from './index';

const renderContent = (sidebar: boolean) =>
  render(
    <MemoryRouter>
      <Content sidebar={sidebar} main={<h1>Страница</h1>} />
    </MemoryRouter>,
  );

describe('Content', () => {
  it('puts the update banner inside the page column, above the page — not beside it', () => {
    renderContent(true);

    const main = screen.getByRole('main');
    const banner = screen.getByRole('status');
    const page = screen.getByRole('heading', { name: 'Страница' });

    // The container of <main> is a flex row: a sibling of <main> would sit next to the page and squeeze it.
    expect(main).toContainElement(banner);
    expect(main).toContainElement(page);
    expect(banner.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no banner without the sidebar layout', () => {
    renderContent(false);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Страница' })).toBeInTheDocument();
  });
});
