import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAllPages } from './fetch-all-pages';

const page = (items: unknown[], next = '') =>
  new Response(JSON.stringify(items), { status: 200, headers: { 'x-next-page': next } });

describe('fetchAllPages', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('follows x-next-page and concatenates pages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([{ id: 1 }, { id: 2 }], '2'))
      .mockResolvedValueOnce(page([{ id: 3 }]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAllPages('https://gl.test/issues?state=closed', {}, 1000, 'закрытых задач');

    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(firstUrl.searchParams.get('per_page')).toBe('100');
    expect(firstUrl.searchParams.get('page')).toBe('1');
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('page')).toBe('2');
  });

  it('makes no extra request for a single page', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page([{ id: 1 }]));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAllPages('https://gl.test/issues', {}, 1000, 'x')).resolves.toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 500 })));

    await expect(fetchAllPages('https://gl.test/issues', {}, 1000, 'открытых задач')).rejects.toThrow(
      'Ошибка HTTP для открытых задач: 500',
    );
  });
});
