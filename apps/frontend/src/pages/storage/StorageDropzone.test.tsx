import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@gravity-ui/uikit';

import { StorageDropzone } from './StorageDropzone';

function renderDropzone(props: Partial<Parameters<typeof StorageDropzone>[0]> = {}) {
  const onUpload = vi.fn();
  render(
    <ThemeProvider theme="light">
      <StorageDropzone upload={null} onUpload={onUpload} {...props} />
    </ThemeProvider>,
  );

  return onUpload;
}

const fileOf = (name: string) => new File(['x'], name, { type: 'text/plain' });

describe('StorageDropzone', () => {
  it('passes every dropped file through, not just the first', () => {
    const onUpload = renderDropzone();
    const dropped = [fileOf('a.txt'), fileOf('b.txt'), fileOf('c.txt')];

    fireEvent.drop(screen.getByText('Перетащите файлы сюда').parentElement!, {
      dataTransfer: { files: dropped },
    });

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0][0].map((file: File) => file.name)).toEqual([
      'a.txt',
      'b.txt',
      'c.txt',
    ]);
  });

  it('lets the picker take more than one file', () => {
    renderDropzone();

    expect(document.querySelector('input[type="file"]')).toHaveAttribute('multiple');
  });

  it('ignores a drop that carries no files', () => {
    const onUpload = renderDropzone();

    fireEvent.drop(screen.getByText('Перетащите файлы сюда').parentElement!, {
      dataTransfer: { files: [] },
    });

    expect(onUpload).not.toHaveBeenCalled();
  });

  it('shows live progress and the position in the batch while uploading', () => {
    renderDropzone({
      upload: { name: 'video.mp4', index: 2, total: 5, percent: 40 },
    });

    expect(screen.getByText('Загрузка 2 из 5')).toBeTruthy();
    expect(screen.getByText('video.mp4')).toBeTruthy();
    // Gravity's Progress renders its label twice (filled + track) for contrast.
    expect(screen.getAllByText('40%').length).toBeGreaterThan(0);
    // The picker is replaced by the status, so a second batch can't be
    // started on top of one already running.
    expect(screen.queryByRole('button', { name: 'Выбрать файлы' })).toBeNull();
  });

  it('drops the batch counter for a single file', () => {
    renderDropzone({ upload: { name: 'a.txt', index: 1, total: 1, percent: 10 } });

    expect(screen.getByText('Загрузка')).toBeTruthy();
  });

  it('highlights on drag and clears the highlight on leave', async () => {
    renderDropzone();
    const zone = screen.getByText('Перетащите файлы сюда').parentElement!;

    fireEvent.dragEnter(zone);
    expect(await screen.findByText('Отпустите файлы')).toBeTruthy();

    fireEvent.dragLeave(zone);
    expect(await screen.findByText('Перетащите файлы сюда')).toBeTruthy();
  });

  it('opens the file picker from the button', async () => {
    const user = userEvent.setup();
    renderDropzone();
    const input = document.querySelector('input[type="file"]')!;
    const click = vi.spyOn(input as HTMLInputElement, 'click');

    await user.click(screen.getByRole('button', { name: 'Выбрать файлы' }));

    expect(click).toHaveBeenCalled();
  });
});
