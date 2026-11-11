import {
  normalizeNotesUrl,
  NotesSendError,
  sendDraft,
} from './lab-digest-notes';

const NOTE = {
  title: 'Неделя 2–8 ноября',
  preview: 'Коротко',
  content: '## Итоги\n\nСделано.',
  tags: ['lab'],
};

const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const TYPES = [
  { id: 1, name: 'DevOps & CI/CD' },
  { id: 6, name: 'Dev Work Diary' },
];

const fake = (
  draft: Response | (() => Response),
  types: Response = reply(200, TYPES),
) =>
  jest.fn(async (...args: [string, RequestInit?]) =>
    args[0].endsWith('/api/v1/types')
      ? types.clone()
      : typeof draft === 'function'
        ? draft()
        : draft.clone(),
  );

const send = (fetchFn: jest.Mock, over: Record<string, unknown> = {}) =>
  sendDraft({
    baseUrl: 'https://notes.example.dev',
    key: 'k'.repeat(40),
    typeName: 'Dev Work Diary',
    note: NOTE,
    fetchFn: fetchFn as unknown as typeof fetch,
    ...over,
  });

describe('normalizeNotesUrl', () => {
  it('keeps the origin of an https site only', () => {
    expect(normalizeNotesUrl(' https://notes.ntlstl.dev/some/path?x=1 ')).toBe(
      'https://notes.ntlstl.dev',
    );
  });

  it.each([
    'http://notes.ntlstl.dev',
    'https://user:pw@notes.ntlstl.dev',
    'https://127.0.0.1',
    'https://[::1]',
    'https://10.0.0.5:3450',
    'https://localhost',
    'https://notes',
    'https://nas.local',
    'https://db.internal',
    'notes.ntlstl.dev',
    '',
  ])('refuses %s', (raw) => {
    expect(() => normalizeNotesUrl(raw)).toThrow(NotesSendError);
  });
});

describe('sendDraft', () => {
  it('finds the type by name and posts the draft with the key', async () => {
    const fetchFn = fake(reply(201, { id: 42, slug: 'nedelya' }));

    await expect(send(fetchFn)).resolves.toEqual({ id: 42, slug: 'nedelya' });

    const [url, init] = fetchFn.mock.calls[1] as [string, RequestInit];

    expect(url).toBe('https://notes.example.dev/api/v1/notes/drafts');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${'k'.repeat(40)}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      ...NOTE,
      type: { id: 6 },
    });
    expect(init.redirect).toBe('error');
  });

  it('matches the type name regardless of case', async () => {
    await expect(
      send(fake(reply(201, { id: 1 })), { typeName: 'dev work diary' }),
    ).resolves.toMatchObject({ id: 1, slug: null });
  });

  it('says so when the site has no such type, and does not post', async () => {
    const fetchFn = fake(reply(201, { id: 1 }));

    await expect(send(fetchFn, { typeName: 'Nope' })).rejects.toMatchObject({
      kind: 'config',
      message: expect.stringContaining('нет типа «Nope»'),
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it.each([
    [404, 'config', 'NOTES_INGEST_KEY'],
    [401, 'config', 'не принял ключ'],
    [503, 'config', 'войдите на сайт'],
    [400, 'config', 'отклонил заметку'],
    [500, 'remote', 'HTTP 500'],
    [502, 'remote', 'HTTP 502'],
  ])('explains an HTTP %i answer', async (status, kind, text) => {
    await expect(send(fake(reply(status)))).rejects.toMatchObject({
      kind,
      message: expect.stringContaining(text),
    });
  });

  it("passes on the site's own words for a refused body", async () => {
    await expect(
      send(
        fake(
          reply(400, {
            message: ['Название должно содержать минимум 3 символа'],
          }),
        ),
      ),
    ).rejects.toThrow('минимум 3 символа');
  });

  it('treats a network failure as the site being away', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNRESET'));

    await expect(send(fetchFn)).rejects.toMatchObject({ kind: 'remote' });
  });

  it('refuses a body the site would not take, before sending it', async () => {
    const fetchFn = fake(reply(201, { id: 1 }));

    await expect(
      send(fetchFn, { note: { ...NOTE, content: 'я'.repeat(50_000) } }),
    ).rejects.toMatchObject({ kind: 'config' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not take an answer without the note number as success', async () => {
    await expect(send(fake(reply(201, { ok: true })))).rejects.toMatchObject({
      kind: 'remote',
    });
  });

  it('stops when the type list cannot be read', async () => {
    await expect(
      send(fake(reply(201, { id: 1 }), reply(500))),
    ).rejects.toMatchObject({ kind: 'remote' });
  });
});
