import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { ResultFilesSection } from './ResultFilesSection';

let calls: string[];

const resultZip = () => zipSync({ 'edit.txt': strToU8('a\nnew\nb'), 'new.txt': strToU8('n') });
const sourceZip = () => zipSync({ 'edit.txt': strToU8('a\nold\nb') });

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');
      calls.push(path);

      return path.startsWith('storage/') ? new Response(sourceZip()) : new Response(resultZip());
    }),
  );
});

afterEach(cleanup);

describe('ResultFilesSection diff view', () => {
  it('shows a diff by default for a modified file and the full text on toggle; source fetched once', async () => {
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <ThemeProvider theme="light">
          <ResultFilesSection jobId={1} sourceFileId={7} />
        </ThemeProvider>
      </Provider>,
    );

    await user.click(screen.getByText('Файлы результата'));
    await user.click(await screen.findByText(/edit\.txt/));
    const diff = screen.getByLabelText('Изменения edit.txt');
    expect(diff.textContent).toContain('- old');
    expect(diff.textContent).toContain('+ new');

    await user.click(screen.getByText('Файл целиком'));
    expect(screen.getByLabelText('Содержимое edit.txt').textContent).toBe('a\nnew\nb');

    await user.click(screen.getByText(/new\.txt/));
    expect(screen.queryByText('Файл целиком')).toBeNull();
    expect(screen.getByLabelText('Содержимое new.txt').textContent).toBe('n');
    expect(calls.filter((c) => c.startsWith('storage/'))).toHaveLength(1);
  });
});
