import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';

import { OpenEncryptedFileDialog } from './OpenEncryptedFileDialog';
import { ParcelKeysCard } from './ParcelKeysCard';

vi.mock('../../shared/lib/parcelKeys', () => ({
  useParcelKeys: () => ({
    keys: [{ id: 'k1', name: 'личный', pem: '-----BEGIN PRIVATE KEY-----' }],
    addKey: vi.fn(),
    removeKey: vi.fn(),
  }),
}));

vi.mock('../../store/api', () => ({
  usePeekFileMutation: () => [vi.fn()],
}));

describe('parcel key field labels', () => {
  it('names the key name and PEM inputs of the import card', () => {
    render(
      <ThemeProvider theme="light">
        <ParcelKeysCard />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText('Название ключа')).toBeTruthy();
    expect(screen.getByLabelText('Ключ в формате PEM')).toBeTruthy();
  });

  it('names the decrypt key field and the saved-key picker in the open dialog', () => {
    render(
      <ThemeProvider theme="light">
        <OpenEncryptedFileDialog file={{ id: 'f1', originalName: 'a.zip.enc' } as never} onClose={vi.fn()} />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText('Приватный ключ (PEM)')).toBeTruthy();
    expect(screen.getByLabelText('Сохранённый ключ')).toBeTruthy();
  });
});
