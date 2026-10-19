import { ThemeProvider } from '@gravity-ui/uikit';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateRsaKeyPair } from '../../shared/lib/keyGeneration';
import { KeyGeneratorCard } from './KeyGeneratorCard';

vi.mock('../../shared/lib/keyGeneration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/lib/keyGeneration')>()),
  generateRsaKeyPair: vi.fn(),
}));

function renderCard(savedKeyNames: string[] = []) {
  const addKeys = vi.fn();

  render(
    <ThemeProvider theme="light">
      <KeyGeneratorCard addKeys={addKeys} savedKeyNames={savedKeyNames} />
    </ThemeProvider>,
  );

  return addKeys;
}

function typeName(value: string) {
  const input = screen.getByPlaceholderText('например, ноутбук');

  fireEvent.change(input, { target: { value } });

  return input;
}

describe('KeyGeneratorCard', () => {
  beforeEach(() => {
    vi.mocked(generateRsaKeyPair).mockReset().mockResolvedValue({
      privateKey: 'PRIV',
      publicKey: 'PUB',
      fingerprint: 'FP',
    });
  });

  it('generates on Enter in a non-empty name field and saves both keys once', async () => {
    const addKeys = renderCard();
    const input = typeName('ноутбук');

    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByText('Скачайте приватный ключ сейчас')).toBeInTheDocument();
    expect(generateRsaKeyPair).toHaveBeenCalledTimes(1);
    expect(addKeys).toHaveBeenCalledTimes(1);
    expect(addKeys).toHaveBeenCalledWith([
      { name: 'ноутбук — приватный', pem: 'PRIV' },
      { name: 'ноутбук — публичный', pem: 'PUB' },
    ]);
  });

  it('does nothing on Enter in an empty name field', async () => {
    const addKeys = renderCard();
    const input = screen.getByPlaceholderText('например, ноутбук');

    fireEvent.submit(input.closest('form')!);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(generateRsaKeyPair).not.toHaveBeenCalled();
    expect(addKeys).not.toHaveBeenCalled();
  });

  it('warns about a name that is already saved and does not generate', async () => {
    const addKeys = renderCard(['ноутбук — приватный']);
    const input = typeName('ноутбук');

    expect(screen.getByText('Ключ с таким именем уже сохранён — добавьте суффикс')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сгенерировать' })).toBeDisabled();

    fireEvent.submit(input.closest('form')!);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(generateRsaKeyPair).not.toHaveBeenCalled();
    expect(addKeys).not.toHaveBeenCalled();
  });

  it('accepts a changed name', async () => {
    const addKeys = renderCard(['ноутбук — приватный']);

    typeName('ноутбук 2');
    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать' }));

    await waitFor(() => expect(addKeys).toHaveBeenCalledTimes(1));
  });
});
