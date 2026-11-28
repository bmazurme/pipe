import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { dashboardApi, type KeyCopy, type RotationItem, type RotationView } from '../../store/api';
import { RotationCard } from './RotationCard';
import { copyText, dueText } from './rotationFacts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const item = (over: Partial<RotationItem>): RotationItem => ({
  key: 'jwt',
  label: 'JWT_SECRET и REFRESH_JWT_SECRET',
  effect: 'все сессии…',
  intervalDays: 365,
  lastRotatedAt: '2026-06-01T00:00:00Z',
  dueAt: '2027-06-01T00:00:00Z',
  daysLeft: 200,
  status: 'ok',
  reasons: [],
  ...over,
});

const copy = (over: Partial<KeyCopy>): KeyCopy => ({ label: 'mac', ok: true, lastCheckAt: new Date().toISOString(), lastOkAt: new Date().toISOString(), backupCreatedAt: null, error: null, ...over });

const VIEW: RotationView = {
  status: 'warn',
  items: [
    item({}),
    item({ key: 'enc-key', label: 'CREDENTIALS_ENC_KEY', status: 'warn', reasons: ['9 значений ещё под старым ключом'], pendingValues: 9 }),
    item({ key: 'age-key', label: 'Ключ age для бэкапов', intervalDays: 0, lastRotatedAt: null, dueAt: null, daysLeft: null, status: 'bad', reasons: ['Копия «usb» не расшифровала последний бэкап: no identity matched'] }),
  ],
  keyCopies: { verified: 1, status: 'bad', reasons: [], copies: [copy({}), copy({ label: 'usb', ok: false, error: 'no identity matched' })] },
};

const renderCard = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <RotationCard />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => store.dispatch(dashboardApi.util.resetApiState()));
afterEach(() => vi.unstubAllGlobals());

describe('dueText', () => {
  it('says what is left, what is overdue, and when nobody marked a date', () => {
    expect(dueText(item({ daysLeft: 25 }))).toBe('следующая смена через 25 дн (раз в 365)');
    expect(dueText(item({ daysLeft: -5 }))).toBe('просрочено на 5 дн');
    expect(dueText(item({ lastRotatedAt: null, daysLeft: null }))).toBe('дата последней смены не отмечена');
    expect(dueText(item({ intervalDays: 0 }))).toBe('');
  });
});

describe('copyText', () => {
  it('names a copy by its label, and how recently it opened a backup', () => {
    const now = Date.parse('2026-12-10T12:00:00Z');

    expect(copyText(copy({ lastOkAt: '2026-12-10T08:00:00Z' }), now)).toBe('«mac»: проверена сегодня');
    expect(copyText(copy({ lastOkAt: '2026-11-30T08:00:00Z' }), now)).toBe('«mac»: проверена 10 дн назад');
    expect(copyText(copy({ ok: false }), now)).toBe('«mac»: не расшифровала');
    expect(copyText(copy({ lastOkAt: null }), now)).toBe('«mac»: не проверена');
  });
});

describe('RotationCard', () => {
  it('shows each key with its verdict, the reasons, and the backup key’s copies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(VIEW)));
    renderCard();

    expect(await screen.findByText('JWT_SECRET и REFRESH_JWT_SECRET')).toBeTruthy();
    expect(screen.getByText('CREDENTIALS_ENC_KEY')).toBeTruthy();
    expect(screen.getByText('9 значений ещё под старым ключом')).toBeTruthy();
    expect(screen.getByText('«mac»: проверена сегодня')).toBeTruthy();
    expect(screen.getByText('«usb»: не расшифровала')).toBeTruthy();
    expect(screen.getByText(/Копия «usb» не расшифровала последний бэкап/)).toBeTruthy();
  });

  it('offers «Сменил(а)» for keys on the calendar but not for the age key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(VIEW)));
    renderCard();

    await screen.findByText('JWT_SECRET и REFRESH_JWT_SECRET');

    expect(screen.getAllByRole('button', { name: 'Сменил(а)' })).toHaveLength(2);
  });

  it('marks a rotation and asks again', async () => {
    const calls: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);

        calls.push(`${request.method} ${new URL(request.url).pathname}`);

        return request.method === 'POST' ? new Response(null, { status: 204 }) : json(VIEW);
      }),
    );
    renderCard();

    await screen.findByText('JWT_SECRET и REFRESH_JWT_SECRET');
    fireEvent.click(screen.getAllByRole('button', { name: 'Сменил(а)' })[0]);

    await waitFor(() => expect(calls).toContain('POST /api/v1/rotation/jwt/rotated'));
    await waitFor(() => expect(calls.filter((c) => c.startsWith('GET')).length).toBeGreaterThanOrEqual(2));
  });

  it('says so when it cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'boom' }, 500)));
    renderCard();

    expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
  });
});
