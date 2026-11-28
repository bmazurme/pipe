import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useChatComposer } from './useChatComposer';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  createChat: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('../../store/api', () => ({
  MAX_ATTACHMENTS_PER_MESSAGE: 5,
  useCreateChatMutation: () => [mocks.createChat],
  useSendMessageMutation: () => [mocks.sendMessage],
}));

vi.mock('./chatAttachments', () => ({
  attachmentProblem: () => null,
  uploadChatAttachment: mocks.upload,
  deleteChatAttachment: vi.fn(),
}));

const FILE = { id: 7, name: 'a.png', size: 1, isImage: true, messageId: null };

type Params = Parameters<typeof useChatComposer>[0];

const baseParams: Params = {
  activeChatId: 1,
  setActiveChatId: vi.fn(),
  newChatModel: 'sonnet',
  newChatContextId: undefined,
  hasPendingReply: false,
  lastReplyStatus: 'complete',
  messagesLoaded: true,
  accessToken: 'token',
};

const setup = (overrides: Partial<Params> = {}) =>
  renderHook((props: Partial<Params>) => useChatComposer({ ...baseParams, ...props }), { initialProps: overrides });

beforeEach(() => {
  mocks.sendMessage.mockReset();
  mocks.sendMessage.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  mocks.upload.mockReset();
  mocks.upload.mockResolvedValue(FILE);
});

describe('useChatComposer', () => {
  it('queues messages while a reply is pending and merges them', async () => {
    const { result } = setup({ hasPendingReply: true });

    await act(() => result.current.send({ content: 'one' }));
    await act(() => result.current.send({ content: 'two' }));

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(result.current.queued).toMatchObject({ chatId: 1, content: 'one\n\ntwo' });
  });

  it('sends the queued message once the reply is complete', async () => {
    const { result, rerender } = setup({ hasPendingReply: true });

    await act(() => result.current.send({ content: 'later' }));
    await act(async () => rerender({ hasPendingReply: false, lastReplyStatus: 'complete' }));

    expect(mocks.sendMessage).toHaveBeenCalledWith({ chatId: 1, content: 'later', attachmentIds: [] });
    expect(result.current.queued).toBeNull();
    expect(result.current.failedDraft).toBeNull();
  });

  it('turns the queued message into a failed draft when the reply failed', async () => {
    const { result, rerender } = setup({ hasPendingReply: true });

    await act(() => result.current.send({ content: 'later' }));
    await act(async () => rerender({ hasPendingReply: false, lastReplyStatus: 'failed' }));

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(result.current.queued).toBeNull();
    expect(result.current.failedDraft).toBe('later');
    expect(result.current.chatError).toMatch(/не отправлено/);
  });

  it('keeps files and draft after a failed send', async () => {
    mocks.sendMessage.mockReturnValue({ unwrap: () => Promise.reject('boom') });
    const { result } = setup();

    await act(() => result.current.attachFiles([new File(['x'], 'a.png')]));
    expect(result.current.pendingFiles).toEqual([FILE]);

    await act(() => result.current.send({ content: 'hello' }));

    expect(result.current.pendingFiles).toEqual([FILE]);
    expect(result.current.failedDraft).toBe('hello');
    expect(result.current.chatError).toBe('boom');
  });

  describe('a message that carries a key', () => {
    const KEY = 'ghp_AbCdEfGhIjKlMnOpQrSt1234';

    it('is held back instead of sent, and only the hidden version is kept', async () => {
      const { result } = setup();

      await act(() => result.current.send({ content: `клонируй с ${KEY}` }));

      expect(mocks.sendMessage).not.toHaveBeenCalled();
      expect(result.current.held?.masked).toBe('клонируй с [скрыто: токен GitHub]');
      expect(result.current.held?.findings).toEqual([{ label: 'токен GitHub', preview: 'ghp_***' }]);
      expect(JSON.stringify(result.current.held)).not.toContain('AbCdEf');
    });

    it('goes out with the key hidden, together with the files attached', async () => {
      const { result } = setup();

      await act(() => result.current.attachFiles([new File(['x'], 'a.png')]));
      await act(() => result.current.send({ content: `ключ ${KEY}` }));
      await act(() => result.current.sendHeldMasked());

      expect(mocks.sendMessage).toHaveBeenCalledWith({ chatId: 1, content: 'ключ [скрыто: токен GitHub]', attachmentIds: [7] });
      expect(result.current.held).toBeNull();
    });

    it('is queued hidden when a reply is still on its way', async () => {
      const { result } = setup({ hasPendingReply: true });

      await act(() => result.current.send({ content: `ключ ${KEY}` }));
      await act(() => result.current.sendHeldMasked());

      expect(mocks.sendMessage).not.toHaveBeenCalled();
      expect(result.current.queued?.content).toBe('ключ [скрыто: токен GitHub]');
    });

    it('can be dropped, and leaving the chat drops it too; an ordinary message is not held', async () => {
      const { result } = setup();

      await act(() => result.current.send({ content: `ключ ${KEY}` }));
      act(() => result.current.discardHeld());
      expect(result.current.held).toBeNull();
      expect(mocks.sendMessage).not.toHaveBeenCalled();

      await act(() => result.current.send({ content: `ключ ${KEY}` }));
      act(() => result.current.reset());
      expect(result.current.held).toBeNull();

      await act(() => result.current.send({ content: 'почему token: refresh не работает?' }));
      expect(result.current.held).toBeNull();
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    });
  });
});
