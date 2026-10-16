import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@gravity-ui/uikit';

import { LabPage } from './LabPage';

const DEFAULT_URL = 'http://localhost:8765';

const STATS_RESPONSE = {
  project: 'rc-boat-demo',
  summary: {
    total_mass_kg: { predicted_count: 2, measured_count: 1, latest_predicted: 1.093, latest_measured: 0.95, diff_pct: -13.1 },
    'hydrostatics.trim_deg': { predicted_count: 2, measured_count: 0, latest_predicted: 1.87, latest_measured: null, diff_pct: null },
  },
};

const HISTORY_RESPONSE = {
  records: [
    { timestamp: '2026-10-16T19:37:17.545493+00:00', kind: 'measured', metrics: { total_mass_kg: 0.95 }, note: 'взвешено' },
  ],
};

function renderPage() {
  return render(
    <ThemeProvider theme="light">
      <LabPage />
    </ThemeProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: () => null,
  });
});

describe('LabPage', () => {
  it('fetches stats/history on load and renders the comparison table', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === `${DEFAULT_URL}/api/stats`) return jsonResponse(STATS_RESPONSE);
        if (url.startsWith(`${DEFAULT_URL}/api/history`)) return jsonResponse(HISTORY_RESPONSE);

        return jsonResponse({}, 404);
      }),
    );

    renderPage();

    expect(await screen.findByText('rc-boat-demo — расчёт vs факт')).toBeTruthy();
    expect(screen.getByText('total_mass_kg')).toBeTruthy();
    expect(screen.getByText('1.093')).toBeTruthy();
    expect(screen.getByText('0.95')).toBeTruthy();
    expect(screen.getByText('-13.1%')).toBeTruthy();
    expect(screen.getByText(/взвешено/)).toBeTruthy();
  });

  it('shows a warning, not a crash, when Lab is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('network error'))));

    renderPage();

    expect(await screen.findByText(new RegExp(`Не удалось подключиться к Lab по адресу ${DEFAULT_URL}`))).toBeTruthy();
  });

  it('saves a new Lab URL to localStorage and refetches from it', async () => {
    const user = userEvent.setup();
    const requestedUrls: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requestedUrls.push(url);
        if (url.includes('/api/stats')) return jsonResponse({ project: 'x', summary: {} });
        if (url.includes('/api/history')) return jsonResponse({ records: [] });

        return jsonResponse({}, 404);
      }),
    );

    renderPage();
    await waitFor(() => expect(requestedUrls.some((u) => u.startsWith(DEFAULT_URL))).toBe(true));

    const input = screen.getByRole('textbox', { name: 'Адрес Lab API' });
    await user.clear(input);
    await user.type(input, 'http://192.168.1.23:8765');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(requestedUrls.some((u) => u.startsWith('http://192.168.1.23:8765'))).toBe(true));
    expect(localStorage.getItem('pipe.labApiUrl')).toBe('"http://192.168.1.23:8765"');
  });

  it('parses key=value lines, posts a measurement, and refreshes on success', async () => {
    const user = userEvent.setup();
    let postedBody: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/api/stats')) return jsonResponse({ project: 'x', summary: {} });
        if (url.endsWith('/api/history?limit=10')) return jsonResponse({ records: [] });
        if (url.endsWith('/api/measure') && init?.method === 'POST') {
          postedBody = JSON.parse(init.body as string);
          return jsonResponse({ kind: 'measured', metrics: postedBody && (postedBody as { metrics: unknown }).metrics, note: '', timestamp: 'now' }, 201);
        }

        return jsonResponse({}, 404);
      }),
    );

    renderPage();
    await waitFor(() => expect(screen.queryByText(/Загрузка/)).toBeNull());

    await user.type(screen.getByRole('textbox', { name: 'Метрики' }), 'total_mass_kg=0.95');
    await user.click(screen.getByRole('button', { name: 'Записать' }));

    await waitFor(() => expect(postedBody).toEqual({ note: '', metrics: { total_mass_kg: 0.95 } }));
  });

  it('shows a parse error instead of sending an unparsable metric line', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/api/stats')) return jsonResponse({ project: 'x', summary: {} });
        if (url.includes('/api/history')) return jsonResponse({ records: [] });

        return jsonResponse({}, 404);
      }),
    );

    renderPage();
    await screen.findByText('Записать замер');

    await user.type(screen.getByRole('textbox', { name: 'Метрики' }), 'not-a-valid-line');
    await user.click(screen.getByRole('button', { name: 'Записать' }));

    expect(await screen.findByText(/Ожидался key=value/)).toBeTruthy();
  });
});
