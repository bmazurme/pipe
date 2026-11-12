import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { ResultFilesSection } from './ResultFilesSection';

let calls: string[];
let respond: () => Response | Promise<Response>;

const renderSection = (jobId: number) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ResultFilesSection jobId={jobId} />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      calls.push(`${request.method} ${new URL(request.url).pathname.replace('/api/v1/', '')}`);

      return respond();
    }),
  );
});

afterEach(cleanup);

const zipResponse = () =>
  new Response(
    zipSync({ 'a.txt': strToU8('hello'), 'b.bin': new Uint8Array([0, 1]), '__sync_manifest__.json': strToU8('{}') }),
  );

describe('ResultFilesSection', () => {
  it('does not fetch until expanded, then lists files and previews text', async () => {
    respond = zipResponse;
    const user = userEvent.setup();
    renderSection(1);
    expect(calls).toEqual([]);

    await user.click(screen.getByText('Файлы результата'));
    await user.click(await screen.findByText(/a\.txt/));
    expect(screen.getByLabelText('Содержимое a.txt').textContent).toBe('hello');
    expect(screen.queryByText(/__sync_manifest__/)).toBeNull();

    await user.click(screen.getByText(/b\.bin/));
    expect(screen.getByText('Не показать — скачайте результат')).toBeTruthy();

    await user.click(screen.getByText('Файлы результата'));
    await user.click(screen.getByText('Файлы результата'));
    expect(calls).toEqual(['GET worker/jobs/1/result/download']);
  });

  it('renders a .md result formatted and lets the reader switch to its source', async () => {
    respond = () =>
      new Response(zipSync({ 'notes/README.md': strToU8('# Заголовок\n\nтекст **жирный**'), 'a.txt': strToU8('# not md') }));
    const user = userEvent.setup();
    renderSection(5);

    await user.click(screen.getByText('Файлы результата'));
    await user.click(await screen.findByText(/README\.md/));

    const region = screen.getByRole('region', { name: 'Содержимое notes/README.md' });
    await vi.waitFor(() => expect(region.querySelector('h1')?.textContent).toContain('Заголовок'));
    expect(region.querySelector('strong')?.textContent).toBe('жирный');

    await user.click(screen.getByText('Исходник'));
    expect(screen.getByLabelText('Содержимое notes/README.md').textContent).toBe('# Заголовок\n\nтекст **жирный**');

    // Another file goes back to its own view; a plain text file is never formatted.
    await user.click(screen.getByText(/a\.txt/));
    expect(screen.getByLabelText('Содержимое a.txt').tagName).toBe('PRE');
    await user.click(screen.getByText(/README\.md/));
    expect(screen.getByRole('region', { name: 'Содержимое notes/README.md' })).toBeTruthy();
  });

  it('shows a loader while the result is being fetched', async () => {
    respond = () => new Promise<Response>(() => {});
    const user = userEvent.setup();
    const { container } = renderSection(2);

    await user.click(screen.getByText('Файлы результата'));
    expect(await vi.waitFor(() => container.querySelector('.g-loader'))).toBeTruthy();
  });

  it('shows an error when the result is not a zip', async () => {
    respond = () => new Response('not a zip');
    const user = userEvent.setup();
    renderSection(3);

    await user.click(screen.getByText('Файлы результата'));
    expect(await screen.findByText('Не удалось прочитать файлы результата')).toBeTruthy();
  });

  it('shows an error when the fetch fails', async () => {
    respond = () => new Response('{}', { status: 500 });
    const user = userEvent.setup();
    renderSection(4);

    await user.click(screen.getByText('Файлы результата'));
    expect(await screen.findByText('Не удалось прочитать файлы результата')).toBeTruthy();
  });
});
