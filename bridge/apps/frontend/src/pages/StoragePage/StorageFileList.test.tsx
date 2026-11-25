import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';

import type { StoredFileMeta } from '../../store/api';
import { StorageFileList } from './StorageFileList';

const base = { mimeType: 'application/zip', size: 10, createdAt: new Date().toISOString() };
const FILES: StoredFileMeta[] = [
  { ...base, id: 1, originalName: 'out.zip', direction: 'outbound', taskKey: '42:6' },
  { ...base, id: 2, originalName: 'res.zip', direction: 'result', taskKey: '42:7' },
  { ...base, id: 3, originalName: 'plain.txt' },
];

function renderList(files: StoredFileMeta[]) {
  return render(
    <ThemeProvider theme="light">
      <MemoryRouter>
        <StorageFileList
          files={files}
          isLoading={false}
          isError={false}
          onRetry={vi.fn()}
          isMobile={false}
          downloadingId={null}
          onDownload={vi.fn()}
          onOpenEncrypted={vi.fn()}
          onDeleteRequest={vi.fn()}
        />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('StorageFileList parcel metadata', () => {
  it('shows direction and task key in the caption', () => {
    renderList(FILES);
    expect(screen.getByText(/← результат · 42:7/)).toBeTruthy();
    expect(screen.getByText(/→ задача · 42:6/)).toBeTruthy();
  });

  it('filters by direction and search', () => {
    renderList(FILES);
    fireEvent.click(screen.getByText('Результаты'));
    expect(screen.queryByText('out.zip')).toBeNull();
    expect(screen.getByText('res.zip')).toBeTruthy();

    fireEvent.click(screen.getByText('Все'));
    fireEvent.change(screen.getByLabelText('Поиск по файлам'), { target: { value: '42:7' } });
    expect(screen.queryByText('out.zip')).toBeNull();
    expect(screen.queryByText('plain.txt')).toBeNull();
    expect(screen.getByText('res.zip')).toBeTruthy();
  });

  it('distinguishes filtered-out from empty', () => {
    renderList(FILES);
    fireEvent.change(screen.getByLabelText('Поиск по файлам'), { target: { value: 'zzz' } });
    expect(screen.getByText('Ничего не найдено')).toBeTruthy();
    expect(screen.queryByText('Файлов пока нет')).toBeNull();
  });

  it('shows the empty state when there are no files', () => {
    renderList([]);
    expect(screen.getByText('Файлов пока нет')).toBeTruthy();
  });
});

describe('StorageFileList "На воркер" action', () => {
  it('is shown for outbound and untagged rows, not for results', () => {
    renderList(FILES);
    expect(screen.getByLabelText('Запустить out.zip на воркере')).toBeTruthy();
    expect(screen.getByLabelText('Запустить plain.txt на воркере')).toBeTruthy();
    expect(screen.queryByLabelText('Запустить res.zip на воркере')).toBeNull();
  });

  it('links to the worker page with the parcel id', () => {
    renderList(FILES);
    expect(screen.getByLabelText('Запустить out.zip на воркере').getAttribute('href')).toBe(
      '/worker?sourceFileId=1',
    );
  });
});
