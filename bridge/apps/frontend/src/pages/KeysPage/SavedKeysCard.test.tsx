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

describe('SavedKeysCard import form', () => {
  function renderWithAdd() {
    const addKey = vi.fn();

    render(
      <ThemeProvider theme="light">
        <SavedKeysCard keys={[]} addKey={addKey} removeKey={vi.fn()} />
      </ThemeProvider>,
    );

    return addKey;
  }

  it('labels both fields', () => {
    renderWithAdd();

    expect(screen.getByLabelText('Название ключа')).toBeInTheDocument();
    expect(screen.getByLabelText('Ключ в формате PEM')).toBeInTheDocument();
  });

  it.each(['Ключ в формате PEM', 'Название ключа'])('clears the not-a-key error when %s is edited', (label) => {
    renderWithAdd();

    fireEvent.change(screen.getByLabelText('Название ключа'), { target: { value: 'k' } });
    fireEvent.change(screen.getByLabelText('Ключ в формате PEM'), { target: { value: 'garbage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать' }));

    expect(screen.getByText(/Похоже, это не ключ/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(label), { target: { value: 'changed' } });

    expect(screen.queryByText(/Похоже, это не ключ/)).not.toBeInTheDocument();
  });

  it('adds a valid key with trimmed values and empties the form', () => {
    const addKey = renderWithAdd();

    fireEvent.change(screen.getByLabelText('Название ключа'), { target: { value: '  k  ' } });
    fireEvent.change(screen.getByLabelText('Ключ в формате PEM'), { target: { value: `  ${PUBLIC.pem}  ` } });
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать' }));

    expect(addKey).toHaveBeenCalledWith('k', PUBLIC.pem.trim());
    expect(screen.getByLabelText('Название ключа')).toHaveValue('');
    expect(screen.getByLabelText('Ключ в формате PEM')).toHaveValue('');
  });
});

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

describe('SavedKeysCard file import', () => {
  function renderImport() {
    const addKey = vi.fn();

    render(
      <ThemeProvider theme="light">
        <SavedKeysCard keys={[]} addKey={addKey} removeKey={vi.fn()} />
      </ThemeProvider>,
    );

    return addKey;
  }

  const choose = (file: File) => fireEvent.change(screen.getByLabelText('Файл ключа'), { target: { files: [file] } });

  it('fills the PEM and the name from the file, then imports on click', async () => {
    const addKey = renderImport();

    choose(new File([PRIVATE.pem], 'work-private.pem'));

    await waitFor(() => expect(screen.getByPlaceholderText('Название')).toHaveValue('work'));
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать' }));

    expect(addKey).toHaveBeenCalledWith('work', PRIVATE.pem.trim());
  });

  it('does not overwrite a name the user typed', async () => {
    renderImport();

    fireEvent.change(screen.getByPlaceholderText('Название'), { target: { value: 'mine' } });
    choose(new File([PUBLIC.pem], 'work-public.pem'));

    await waitFor(() => expect(screen.getByPlaceholderText(/BEGIN PRIVATE KEY/)).toHaveValue(PUBLIC.pem));
    expect(screen.getByPlaceholderText('Название')).toHaveValue('mine');
  });

  it('rejects a non-key file and an oversized file without touching the fields', async () => {
    renderImport();

    choose(new File(['hello'], 'notes.txt'));
    expect(await screen.findByText(/Похоже, это не ключ/)).toBeInTheDocument();

    choose(new File(['x'.repeat(64 * 1024 + 1)], 'big.pem'));
    expect(await screen.findByText(/слишком большой/)).toBeInTheDocument();

    expect(screen.getByPlaceholderText('Название')).toHaveValue('');
    expect(screen.getByPlaceholderText(/BEGIN PRIVATE KEY/)).toHaveValue('');
  });
});
