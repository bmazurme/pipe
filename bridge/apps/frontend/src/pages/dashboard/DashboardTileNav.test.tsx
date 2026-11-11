import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardTileNav } from './DashboardTileNav';

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

describe('DashboardTileNav', () => {
  it('lists every tile as a link to its anchor, with the state as a labelled dot', () => {
    render(<DashboardTileNav levels={{ 'tile-nas': 'warn', 'tile-cloud': 'bad' }} ready />);

    expect(screen.getByRole('navigation', { name: 'Плитки дашборда' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Облако/ })).toHaveAttribute('href', '#tile-cloud');
    expect(screen.getByRole('link', { name: /Облако/ })).toContainElement(screen.getByRole('img', { name: 'проблема' }));
    expect(screen.getByRole('link', { name: /NAS/ })).toContainElement(screen.getByRole('img', { name: 'замечания' }));
    expect(within(screen.getByRole('link', { name: /Роутер/ })).getByRole('img', { name: 'в порядке' })).toBeInTheDocument();
  });

  it('claims nothing about a tile while the page is still loading', () => {
    render(<DashboardTileNav levels={{}} ready={false} />);

    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('scrolls to the tile and keeps its hash in the URL', () => {
    const target = document.createElement('section');
    target.id = 'tile-nas';
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);
    render(<DashboardTileNav levels={{}} ready />);

    fireEvent.click(screen.getByRole('link', { name: /NAS/ }));

    expect(target.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
    expect(window.location.hash).toBe('#tile-nas');
  });

  it('lets the browser follow the link when the tile is not on the page', () => {
    render(<DashboardTileNav levels={{}} ready />);

    expect(fireEvent.click(screen.getByRole('link', { name: /NAS/ }))).toBe(true);
  });
});
