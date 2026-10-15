const PER_PAGE = 100;
const MAX_PAGES = 50;

// GitLab's default page size is 20 — without per_page and the page loop, anything past the
// twentieth issue silently dropped out of the report.
export async function fetchAllPages<T>(
  url: string,
  fetchConfig: RequestInit,
  timeoutMs: number,
  errorLabel: string,
): Promise<T[]> {
  const items: T[] = [];
  let page: string | null = '1';

  for (let fetched = 0; page && fetched < MAX_PAGES; fetched += 1) {
    const pageUrl = new URL(url);
    pageUrl.searchParams.set('per_page', String(PER_PAGE));
    pageUrl.searchParams.set('page', page);

    const response = await fetch(pageUrl.toString(), {
      ...fetchConfig,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Ошибка HTTP для ${errorLabel}: ${response.status}`);
    }

    items.push(...((await response.json()) as T[]));
    page = response.headers.get('x-next-page')?.trim() || null;
  }

  return items;
}
