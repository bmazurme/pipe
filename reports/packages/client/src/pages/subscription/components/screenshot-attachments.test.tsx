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
  it('reads a picture as base64 and refuses what is not one, too big, or over the limit', async () => {
    const { added, problems } = await toAttachments(
      [png('a.png', 3), new File(['x'], 'notes.txt', { type: 'text/plain' }), png('big.png', MAX_ATTACHMENT_BYTES + 1)],
      0,
    );

    expect(added.map((item) => item.name)).toEqual(['a.png']);
    expect(added[0].base64).toBe(btoa(String.fromCharCode(0, 0, 0)));
    expect(problems).toHaveLength(2);

    const full = await toAttachments([png('late.png')], MAX_ATTACHMENTS);
    expect(full.added).toEqual([]);
    expect(full.problems[0]).toMatch(/Не больше/);
  });
});

describe('ScreenshotAttachments', () => {
  it('attaches a picked file, lists it with its size, and removes it again', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.upload(screen.getByLabelText('Выбрать скриншоты'), png('crash.png'));

    expect(await screen.findByText('crash.png')).toBeInTheDocument();
    expect(screen.getByTestId('count')).toHaveTextContent('1');

    await user.click(screen.getByRole('button', { name: 'Убрать crash.png' }));

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'));
  });

  it('says why a file was not taken', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness />);

    await user.upload(screen.getByLabelText('Выбрать скриншоты'), new File(['x'], 'notes.txt', { type: 'text/plain' }));

    expect(await screen.findByText(/не PNG, JPEG, GIF или WebP/)).toBeInTheDocument();
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });
});
