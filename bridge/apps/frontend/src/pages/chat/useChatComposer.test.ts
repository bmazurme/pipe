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
});
