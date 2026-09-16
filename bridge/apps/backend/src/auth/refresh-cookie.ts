/**
 * The refresh cookie's name is deliberately app-specific.
 *
 * Several sibling apps on *.ntlstl.dev (notes, tools, rain) are ports of this
 * same codebase and set their own refresh cookie with `COOKIE_DOMAIN=.ntlstl.dev`
 * — a parent-domain cookie that every subdomain receives, this API included.
 * When two cookies share a name and path but differ in Domain, the browser
 * keeps both and sends both, and cookie-parser surfaces only the first
 * (RFC 6265 orders equal-path cookies by creation time, so the older sibling
 * wins). This API then verified a neighbouring app's token against its own
 * secret, failed with "invalid signature", and returned 401 — with no way for
 * a fresh sign-in here to overwrite or delete a cookie scoped to a domain it
 * doesn't own. The only escape was clearing cookies by hand.
 *
 * A distinct name removes the collision outright.
 */
export const REFRESH_COOKIE_NAME = 'bridgeRefreshToken';

/**
 * What this app used to call its refresh cookie — the name it shared with its
 * siblings. Cleared on sign-in and sign-out so the stale value doesn't linger,
 * scoped to this API's own COOKIE_DOMAIN. The parent-domain cookie belonging
 * to the other apps is deliberately left alone: clearing it would sign the
 * user out of notes/tools/rain.
 */
export const LEGACY_REFRESH_COOKIE_NAME = 'refreshToken';

/** More same-name cookies than this and something is wrong; don't spend DB lookups on it. */
const MAX_CANDIDATES = 5;

/**
 * Every value the raw Cookie header carries for `name`, not just the first.
 *
 * `req.cookies` collapses duplicates, which is the behaviour that let a
 * sibling app's token shadow this one's. Reading the header directly lets the
 * guard try each candidate, so a valid cookie is still honoured when it isn't
 * the one the parser happened to pick.
 */
export function readCookieValues(
  cookieHeader: string | undefined,
  name: string,
): string[] {
  if (!cookieHeader) {
    return [];
  }

  const values: string[] = [];

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');

    if (separator === -1) {
      continue;
    }

    if (part.slice(0, separator).trim() !== name) {
      continue;
    }

    const raw = part.slice(separator + 1).trim();

    if (!raw) {
      continue;
    }

    try {
      values.push(decodeURIComponent(raw));
    } catch {
      // A malformed percent-escape shouldn't discard an otherwise usable
      // cookie — fall back to the value exactly as sent.
      values.push(raw);
    }

    if (values.length === MAX_CANDIDATES) {
      break;
    }
  }

  return values;
}
