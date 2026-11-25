import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { ResultFilesSection } from './ResultFilesSection';

let calls: string[];
let sourceResponse: () => Response;

const resultZip = () => zipSync({ 'same.txt': strToU8('s'), 'edit.txt': strToU8('new'), 'new.txt': strToU8('n') });
const sourceZip = () => zipSync({ 'same.txt': strToU8('s'), 'edit.txt': strToU8('old'), 'gone.txt': strToU8('g') });

const renderSection = (sourceFileId: number | null) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ResultFilesSection jobId={1} sourceFileId={sourceFileId} />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');
      calls.push(`${request.method} ${path}`);

      return path.startsWith('storage/') ? sourceResponse() : new Response(resultZip());
    }),
  );
});

afterEach(cleanup);

describe('ResultFilesSection source comparison', () => {
  it('shows only changed files with badges, deleted paths and a summary; the switch lists all', async () => {
    sourceResponse = () => new Response(sourceZip());
    const user = userEvent.setup();
    renderSection(7);

    await user.click(screen.getByText('Файлы результата'));
    expect(await screen.findByText(/edit\.txt/)).toBeTruthy();
    expect(screen.getByText(/new\.txt/)).toBeTruthy();
    expect(screen.queryByText(/same\.txt/)).toBeNull();
    expect(screen.getByText('новый')).toBeTruthy();
    expect(screen.getByText('изменён')).toBeTruthy();
    expect(screen.getByText(/Удалены: gone\.txt/)).toBeTruthy();
    expect(screen.getByText(/Изменено 2 из 3 файлов/)).toBeTruthy();
    expect(calls).toEqual(['GET worker/jobs/1/result/download', 'GET storage/7/peek']);

    await user.click(screen.getByText('Только изменённые'));
    expect(screen.getByText(/same\.txt/)).toBeTruthy();
  });

  it.each([
    ['null source', null, () => new Response(sourceZip())],
    ['404', 7, () => new Response('nope', { status: 404 })],
    ['non-zip', 7, () => new Response('not a zip')],
  ])('falls back to the plain list: %s', async (_name, id, respond) => {
    sourceResponse = respond;
    const user = userEvent.setup();
    renderSection(id);

    await user.click(screen.getByText('Файлы результата'));
    expect(await screen.findByText(/same\.txt/)).toBeTruthy();
    expect(screen.queryByText('Только изменённые')).toBeNull();
    expect(screen.queryByText(/Изменено/)).toBeNull();
  });
});
