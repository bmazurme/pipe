import { ThemeProvider } from '@gravity-ui/uikit';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SavedKeysCard } from './SavedKeysCard';

vi.mock('../../shared/lib/keyGeneration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/lib/keyGeneration')>()),
  fingerprintOfPublicKey: vi.fn().mockRejectedValue(new Error('boom')),
}));

const PRIVATE = { id: 'a', name: 'my-private', pem: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n' };
const PUBLIC = { id: 'b', name: 'my-public', pem: '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n' };

function renderCard(removeKey = vi.fn()) {
  render(
    <ThemeProvider theme="light">
      <SavedKeysCard keys={[PRIVATE, PUBLIC]} addKey={vi.fn()} removeKey={removeKey} />
    </ThemeProvider>,
  );

  return removeKey;
}

describe('SavedKeysCard removal', () => {
  it('does not remove the key until the user confirms', async () => {
    const removeKey = renderCard();

    fireEvent.click(screen.getByLabelText('Удалить ключ: my-public'));

    expect(removeKey).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }));

    expect(removeKey).toHaveBeenCalledWith('b');
  });

  it('keeps the key on cancel', async () => {
    const removeKey = renderCard();

    fireEvent.click(screen.getByLabelText('Удалить ключ: my-public'));
    fireEvent.click(await screen.findByRole('button', { name: 'Отмена' }));

    expect(removeKey).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Отмена' })).not.toBeInTheDocument());
  });

  it('warns about irreversibility for a private key only', async () => {
    renderCard();

    fireEvent.click(screen.getByLabelText('Удалить ключ: my-private'));

    expect(await screen.findByText(/больше не откроются/)).toBeInTheDocument();
  });

  it('shows a short generic text for a public key', async () => {
    renderCard();

    fireEvent.click(screen.getByLabelText('Удалить ключ: my-public'));

    expect(await screen.findByText('Ключ будет удалён из этого браузера.')).toBeInTheDocument();
    expect(screen.queryByText(/больше не откроются/)).not.toBeInTheDocument();
  });

  it('shows a dash when the fingerprint cannot be computed', async () => {
    renderCard();

    expect(await screen.findByTitle('Не удалось вычислить отпечаток ключа')).toHaveTextContent('—');
  });
});
