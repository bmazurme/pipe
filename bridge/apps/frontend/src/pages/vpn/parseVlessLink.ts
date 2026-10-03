// A vless:// link has no panel URL/API token (those are admin-only, never
// part of a client link) — it only ever autofills the server address, and
// the name when the link carries a remark and nothing's been typed yet.
export function parseVlessLink(raw: string): { serverAddress: string; name: string | null } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'vless:' || !url.hostname) return null;

  return {
    serverAddress: url.hostname,
    name: url.hash ? decodeURIComponent(url.hash.slice(1)) || null : null,
  };
}
