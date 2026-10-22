import { useState } from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@gravity-ui/uikit';

import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, toAttachments, type Attachment } from './attachments';
import { ScreenshotAttachments } from './screenshot-attachments';

beforeAll(() => {
  // jsdom has no object URLs.
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

const png = (name = 'shot.png', size = 4) => new File([new Uint8Array(size)], name, { type: 'image/png' });

function Harness({ initial = [] as Attachment[] }) {
  const [value, setValue] = useState<Attachment[]>(initial);

  return (
    <ThemeProvider theme="light">
      <ScreenshotAttachments value={value} onChange={setValue} />
      <output data-testid="count">{value.length}</output>
    </ThemeProvider>
  );
}

describe('toAttachments', () => {
  it('reads any file as base64 — a picture with a preview, anything else without — and refuses an empty one, a too big one, or one over the limit', async () => {
    const { added, problems } = await toAttachments(
      [png('a.png', 3), new File(['{"a":1}'], 'data.json', { type: 'application/json' }), new File([''], 'empty.txt'), png('big.png', MAX_ATTACHMENT_BYTES + 1)],
      0,
    );

    expect(added.map((item) => item.name)).toEqual(['a.png', 'data.json']);
    expect(added[0].base64).toBe(btoa(String.fromCharCode(0, 0, 0)));
    expect(added[0].previewUrl).toBe('blob:preview');
    expect(added[1].previewUrl).toBe('');
    expect(atob(added[1].base64)).toBe('{"a":1}');
    expect(problems).toHaveLength(2);

    const full = await toAttachments([png('late.png')], MAX_ATTACHMENTS);
    expect(full.added).toEqual([]);
    expect(full.problems[0]).toMatch(/Не больше/);
  });

  it('takes a file with no type at all, such as a .msg', async () => {
    const { added, problems } = await toAttachments([new File(['mail'], 'letter.msg')], 0);

    expect(problems).toEqual([]);
    expect(added[0]).toMatchObject({ name: 'letter.msg', previewUrl: '' });
  });
});

describe('ScreenshotAttachments', () => {
  it('attaches a picked file, lists it with its size, and removes it again', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.upload(screen.getByLabelText('Выбрать файлы'), png('crash.png'));

    expect(await screen.findByText('crash.png')).toBeInTheDocument();
    expect(screen.getByTestId('count')).toHaveTextContent('1');

    await user.click(screen.getByRole('button', { name: 'Убрать crash.png' }));

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'));
  });

  it('attaches a file that is not a picture, and says that attachments are not anonymized', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByText(/не проходят ни замену по словарю, ни проверку/)).toBeInTheDocument();
    await user.upload(screen.getByLabelText('Выбрать файлы'), [new File(['mail'], 'letter.msg'), new File(['{}'], 'data.json', { type: 'application/json' })]);

    expect(await screen.findByText('letter.msg')).toBeInTheDocument();
    expect(screen.getByText('data.json')).toBeInTheDocument();
    expect(screen.getByTestId('count')).toHaveTextContent('2');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('says why a file was not taken', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.upload(screen.getByLabelText('Выбрать файлы'), new File([''], 'empty.json'));

    expect(await screen.findByText(/«empty.json» пустой/)).toBeInTheDocument();
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });
});
