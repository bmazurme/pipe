import { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AppLayout } from './AppLayout';
import { AppThemeProvider } from '../providers/ThemeProvider';
import { store } from '../../store';

/** Drives useIsMobile, which reads the 767px media query. */
function setViewport(isMobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('max-width: 767px') ? isMobile : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

function renderLayout(ui: ReactElement) {
  return render(
    <Provider store={store}>
      <AppThemeProvider>
        <MemoryRouter initialEntries={['/profile']}>{ui}</MemoryRouter>
      </AppThemeProvider>
    </Provider>,
  );
}

const layoutRoutes = (
  <Routes>
    <Route element={<AppLayout />}>
      <Route path="/profile" element={<div>содержимое</div>} />
      <Route path="/" element={<div>главная</div>} />
    </Route>
  </Routes>
);

beforeEach(() => {
  // The logout mutation is the only request this tree can fire.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
});

describe('AppLayout', () => {
  it('renders the desktop aside with a localized collapse control', () => {
    setViewport(false);
    renderLayout(layoutRoutes);

    // The CompositeBar autosizer measures 0 in jsdom, so the nav rows never
    // mount — the footer and the collapse control are what can be asserted.
    expect(screen.getByTitle('Свернуть меню ([)')).toBeTruthy();
    expect(screen.getByTitle('Системная тема')).toBeTruthy();
    expect(screen.getByTitle('Профиль')).toBeTruthy();
    expect(screen.getByTitle('Выйти')).toBeTruthy();
    expect(screen.getByText('содержимое')).toBeTruthy();
  });

  it('renders the mobile header instead of the aside', () => {
    setViewport(true);
    renderLayout(layoutRoutes);

    expect(screen.getByRole('button', { name: 'Открыть меню' })).toBeTruthy();
    expect(screen.queryByTitle('Свернуть меню ([)')).toBeNull();
    expect(screen.getByText('содержимое')).toBeTruthy();
  });

  it('offers a skip link that targets the main landmark', () => {
    setViewport(false);
    renderLayout(layoutRoutes);

    // Reaching the page otherwise means tabbing through every sidebar row.
    const skip = screen.getByRole('link', { name: 'Перейти к содержимому' });
    expect(skip).toHaveAttribute('href', '#main-content');

    const main = document.querySelector('main');
    expect(main).toHaveAttribute('id', 'main-content');
    // Focusable so the browser actually moves focus when the link is used.
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('routes a logo click instead of reloading the document', async () => {
    setViewport(false);
    const user = userEvent.setup();
    renderLayout(layoutRoutes);

    expect(screen.getByText('содержимое')).toBeTruthy();
    await user.click(screen.getByRole('link', { name: /ntlstl/ }));

    // A bare href would have left the router untouched (and, in a browser,
    // thrown away every cached query on the way to the same page).
    expect(await screen.findByText('главная')).toBeTruthy();
  });

  it('closes the burger when a footer action navigates away', async () => {
    setViewport(true);
    const user = userEvent.setup();
    renderLayout(layoutRoutes);

    await user.click(screen.getByRole('button', { name: 'Открыть меню' }));
    const profileRow = await screen.findByText('Профиль');
    expect(screen.getByText('Выйти')).toBeTruthy();

    // MobileHeader only auto-closes for menu rows; footer actions have to
    // dispatch the close event themselves or the drawer stays over the page.
    await user.click(profileRow);
    await waitFor(() => expect(screen.queryByText('Выйти')).toBeNull());
  });
});
