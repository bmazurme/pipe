import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@gravity-ui/uikit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { JobLogs } from './JobLogs';

const download = vi.hoisted(() => vi.fn());

vi.mock('../../shared/lib/parcelCrypto', () => ({ triggerBlobDownload: download }));

const renderLogs = (props: Partial<Parameters<typeof JobLogs>[0]> = {}) =>
  render(
    <ThemeProvider theme="light">
      <JobLogs jobId={5} logs={'one\ntwo\nthree\n'} active {...props} />
    </ThemeProvider>,
  );

// jsdom lays nothing out: give the log box a scrollable size so "at the end" can mean something.
function sizeLogBox(box: HTMLElement, { scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(box, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(box, 'clientHeight', { configurable: true, value: clientHeight });
}

afterEach(() => download.mockReset());

describe('JobLogs', () => {
  it('counts the lines and shows the text', () => {
    renderLogs();

    expect(screen.getByText(/3 строки/)).toBeInTheDocument();
    expect(screen.getByText(/one/)).toBeInTheDocument();
  });

  it('says the log is empty so far', () => {
    renderLogs({ logs: '' });

    expect(screen.getByText('(пока пусто)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Копировать/ })).not.toBeInTheDocument();
  });

  it('follows the tail while the reader is at the end', () => {
    const { container, rerender } = renderLogs();
    const box = container.querySelector('pre') as HTMLElement;
    sizeLogBox(box, { scrollHeight: 1000, clientHeight: 300 });

    rerender(
      <ThemeProvider theme="light">
        <JobLogs jobId={5} logs={'one\ntwo\nthree\nfour\n'} active />
      </ThemeProvider>,
    );

    expect(box.scrollTop).toBe(1000);
    expect(screen.queryByRole('button', { name: /К концу/ })).not.toBeInTheDocument();
  });

  it('stops following once the reader scrolls up, and offers a way back to the end', async () => {
    const user = userEvent.setup();
    const { container, rerender } = renderLogs();
    const box = container.querySelector('pre') as HTMLElement;
    sizeLogBox(box, { scrollHeight: 1000, clientHeight: 300 });

    box.scrollTop = 100;
    fireEvent.scroll(box);

    rerender(
      <ThemeProvider theme="light">
        <JobLogs jobId={5} logs={'one\ntwo\nthree\nfour\n'} active />
      </ThemeProvider>,
    );

    // New output arrived, and the reader was left where they were.
    expect(box.scrollTop).toBe(100);

    await user.click(screen.getByRole('button', { name: /К концу/ }));

    expect(box.scrollTop).toBe(1000);
    expect(screen.queryByRole('button', { name: /К концу/ })).not.toBeInTheDocument();
  });

  it('has no jump button for a finished job', () => {
    const { container } = renderLogs({ active: false });
    const box = container.querySelector('pre') as HTMLElement;
    sizeLogBox(box, { scrollHeight: 1000, clientHeight: 300 });

    box.scrollTop = 0;
    fireEvent.scroll(box);

    expect(screen.queryByRole('button', { name: /К концу/ })).not.toBeInTheDocument();
  });

  it.each([
    [1, '1 строка'],
    [3, '3 строки'],
    [5, '5 строк'],
    [21, '21 строка'],
    [22, '22 строки'],
  ])('pluralizes %i lines', (count, text) => {
    renderLogs({ logs: Array.from({ length: count }, (_, i) => `l${i}`).join('\n') });

    expect(screen.getByText(new RegExp(text))).toBeInTheDocument();
  });

  it('makes the log focusable with an accessible name', () => {
    renderLogs();

    expect(screen.getByRole('region', { name: 'Лог задачи' })).toHaveAttribute('tabindex', '0');
  });

  it('reports a failed copy', async () => {
    const user = userEvent.setup();
    renderLogs();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));

    await user.click(screen.getByRole('button', { name: /Копировать/ }));

    expect(await screen.findByText('Не удалось скопировать')).toBeInTheDocument();
  });

  it('confirms a successful copy', async () => {
    const user = userEvent.setup();
    renderLogs();
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    await user.click(screen.getByRole('button', { name: /Копировать/ }));

    expect(await screen.findByText('Скопировано')).toBeInTheDocument();
  });

  it('downloads the log as a .log file named after the job', async () => {
    const user = userEvent.setup();
    renderLogs();

    await user.click(screen.getByRole('button', { name: /Скачать \.log/ }));

    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0][1]).toBe('job-5.log');
    expect(await (download.mock.calls[0][0] as Blob).text()).toBe('one\ntwo\nthree\n');
  });
});

describe('JobLogs filter', () => {
  // 200 lines, three of which mention an error in some case.
  const longLog = `${Array.from({ length: 200 }, (_, i) =>
    i === 10 ? 'Error: boom' : i === 50 ? 'an error here' : i === 150 ? 'ERROR again' : `line ${i}`,
  ).join('\n')}\n`;

  const logBox = () => screen.getByRole('region', { name: 'Лог задачи' });

  it('shows only the matching lines, case-insensitively, with a counter', async () => {
    const user = userEvent.setup();
    renderLogs({ logs: longLog });

    await user.type(screen.getByRole('textbox', { name: 'Фильтр строк лога' }), 'error');

    expect(logBox().textContent).toBe('Error: boom\nan error here\nERROR again');
    expect(screen.getByText(/3 из 200 строк/)).toBeInTheDocument();
  });

  it('clears the filter with the reset button', async () => {
    const user = userEvent.setup();
    renderLogs({ logs: longLog });

    await user.type(screen.getByRole('textbox', { name: 'Фильтр строк лога' }), 'error');
    await user.click(screen.getByRole('button', { name: 'Сбросить' }));

    expect(logBox().textContent).toBe(longLog);
    expect(screen.getByText(/200 строк/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сбросить' })).not.toBeInTheDocument();
  });

  it('clears the filter with Escape', async () => {
    const user = userEvent.setup();
    renderLogs({ logs: longLog });
    const input = screen.getByRole('textbox', { name: 'Фильтр строк лога' });

    await user.type(input, 'error');
    await user.keyboard('{Escape}');

    expect(input).toHaveValue('');
    expect(logBox().textContent).toBe(longLog);
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    renderLogs();

    await user.type(screen.getByRole('textbox', { name: 'Фильтр строк лога' }), 'zzz');

    expect(logBox()).toHaveTextContent('Нет строк с «zzz»');
    expect(screen.getByText(/0 из 3 строк/)).toBeInTheDocument();
  });

  it('still downloads and copies the full, unfiltered log', async () => {
    const user = userEvent.setup();
    renderLogs();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    await user.type(screen.getByRole('textbox', { name: 'Фильтр строк лога' }), 'two');
    expect(logBox().textContent).toBe('two');

    await user.click(screen.getByRole('button', { name: /Скачать \.log/ }));
    await user.click(screen.getByRole('button', { name: /Копировать/ }));

    expect(await (download.mock.calls[0][0] as Blob).text()).toBe('one\ntwo\nthree\n');
    expect(writeText).toHaveBeenCalledWith('one\ntwo\nthree\n');
  });

  it('keeps following the tail of the filtered view as matching lines arrive', () => {
    const { container, rerender } = renderLogs();
    const box = container.querySelector('pre') as HTMLElement;
    sizeLogBox(box, { scrollHeight: 1000, clientHeight: 300 });

    fireEvent.change(screen.getByRole('textbox', { name: 'Фильтр строк лога' }), { target: { value: 't' } });
    box.scrollTop = 0;

    rerender(
      <ThemeProvider theme="light">
        <JobLogs jobId={5} logs={'one\ntwo\nthree\nten\n'} active />
      </ThemeProvider>,
    );

    expect(box.textContent).toBe('two\nthree\nten');
    expect(box.scrollTop).toBe(1000);
  });
});
