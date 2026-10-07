import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@gravity-ui/uikit';

import { KeysPage } from './KeysPage';

const STORAGE_KEY = 'pipe.parcelKeys';

// Key generation is slow at 4096 bits; the page's own default is exercised separately by
// shared/lib/keyGeneration.test.ts, here we only care about the flow.
vi.mock('../shared/lib/keyGeneration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/lib/keyGeneration')>();

  return {
    ...actual,
    generateRsaKeyPair: vi.fn(async () => ({
      publicKey: '-----BEGIN PUBLIC KEY-----\nPUB\n-----END PUBLIC KEY-----\n',
      privateKey: '-----BEGIN PRIVATE KEY-----\nPRIV\n-----END PRIVATE KEY-----\n',
      fingerprint: 'AA:BB',
    })),
    fingerprintOfPublicKey: vi.fn(async () => 'AA:BB'),
  };
});

function renderPage() {
  return render(
    <ThemeProvider theme="light">
      <KeysPage />
    </ThemeProvider>,
  );
}

function storedKeys(): Array<{ name: string; pem: string }> {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
}

beforeEach(() => {
  // jsdom's localStorage can be missing under some Node versions — give the page a real one.
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  });
  vi.stubGlobal('window', Object.assign(window, { localStorage: globalThis.localStorage }));
});

describe('KeysPage', () => {
  it('keeps Generate disabled until the pair has a name', async () => {
    const user = userEvent.setup();
    renderPage();

    const button = screen.getByRole('button', { name: 'Сгенерировать' });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText('Название'), 'ноутбук');
    expect(button).toBeEnabled();
  });

  it('generates a pair, shows both keys with a warning, and saves them under one name', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Название'), 'ноутбук');
    await user.click(screen.getByRole('button', { name: 'Сгенерировать' }));

    expect(await screen.findByText('Скачайте приватный ключ сейчас')).toBeTruthy();
    expect((screen.getByLabelText('Публичный ключ') as HTMLTextAreaElement).value).toContain('BEGIN PUBLIC KEY');
    expect((screen.getByLabelText('Приватный ключ') as HTMLTextAreaElement).value).toContain('BEGIN PRIVATE KEY');
    // The fingerprint is shown with the new pair and again on the saved public key's row.
    await waitFor(() => expect(screen.getAllByText('AA:BB').length).toBeGreaterThanOrEqual(2));

    await waitFor(() => expect(storedKeys().map((key) => key.name)).toEqual(['ноутбук — приватный', 'ноутбук — публичный']));

    // …and they show up in the saved-keys list on the same page straight away.
    expect(await screen.findByText('ноутбук — приватный')).toBeTruthy();
    expect(screen.getByText('ноутбук — публичный')).toBeTruthy();
    expect(screen.queryByText('Ключей пока нет')).toBeNull();
  });

  it('does not save to the browser when that box is cleared', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Название'), 'x');
    await user.click(screen.getByText(/Сохранить в этом браузере/));
    await user.click(screen.getByRole('button', { name: 'Сгенерировать' }));

    await screen.findByText('Скачайте приватный ключ сейчас');
    expect(storedKeys()).toEqual([]);
    expect(screen.getByText(/Его нет нигде, кроме этой страницы/)).toBeTruthy();
  });

  it('imports a key, labels it, and lets it be removed', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText('Название'), 'чужой');
    await user.type(screen.getByPlaceholderText(/BEGIN PRIVATE KEY/), '-----BEGIN PUBLIC KEY-----abc-----END PUBLIC KEY-----');
    await user.click(screen.getByRole('button', { name: 'Импортировать' }));

    expect(await screen.findByText('публичный')).toBeTruthy();
    expect(storedKeys()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Удалить ключ: чужой' }));

    await waitFor(() => expect(storedKeys()).toHaveLength(0));
  });

  it('rejects text that is not a key', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText('Название'), 'bad');
    await user.type(screen.getByPlaceholderText(/BEGIN PRIVATE KEY/), 'hello');
    await user.click(screen.getByRole('button', { name: 'Импортировать' }));

    expect(await screen.findByText(/это не ключ/)).toBeTruthy();
    expect(storedKeys()).toHaveLength(0);
  });
});
