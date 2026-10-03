# Unified machine auth

Part of [ECOSYSTEM.md](../ECOSYSTEM.md)'s cross-cutting detail — see that
file for the full index.

bridge supports personal, revocable API keys alongside its existing
browser OAuth flow — additive, nothing about existing sessions changed.
Mint one from bridge's Profile page ("API-ключи" card,
[ApiKeysSection.tsx](../bridge/apps/frontend/src/pages/profile/ApiKeysSection.tsx));
it's shown once at creation and only its SHA-256 hash is stored
([api-keys.service.ts](../bridge/apps/backend/src/auth/api-keys.service.ts),
migration
[AddApiKeys](../bridge/apps/backend/src/migrations/1789587965450-AddApiKeys.ts)).
`StorageController` accepts either the key (`X-Api-Key` header, or
`Authorization: Bearer brk_...`) or a normal OAuth access token
([JwtOrApiKeyGuard](../bridge/apps/backend/src/auth/guards/jwt-or-api-key.guard.ts)) —
so a machine caller no longer has to impersonate a human's browser session.

- **sync**: `sync-cli login-api-key <key>` ([commands/loginApiKey.ts](../sync/src/commands/loginApiKey.ts))
  stores it alongside (not instead of) the existing refresh-token login;
  [bridgeClient.ts](../sync/src/bridgeClient.ts) prefers it when present, with
  no refresh dance needed at all.
- **reports**: new Settings field "Bridge storage API key"
  (`bridgeStorageApiKey`, distinct from the pre-existing `bridgeApiKey`,
  which is the unrelated `TIME_EXPORT_API_KEY` shared secret) — preferred by
  [subscription/bridge-client.ts](../reports/packages/server/src/subscription/bridge-client.ts)
  over replaying `bridgeRefreshToken` when set.
- **worker**: `BRIDGE_API_KEY` env var, consumed by
  [worker/src/bridgeClient.ts](../worker/src/bridgeClient.ts) — the *only*
  auth method it supports (no refresh-token fallback at all, unlike
  sync/reports, since worker is a headless server process with no browser
  session to ever have replayed in the first place).
  [WorkerController](../bridge/apps/backend/src/worker/worker.controller.ts)
  reuses the same `JwtOrApiKeyGuard` as `StorageController` for every
  route, human and machine alike — as does
  [ChatController](../bridge/apps/backend/src/chat/chat.controller.ts): the
  same `BRIDGE_API_KEY` worker already has authenticates its chat-turn
  polling too, nothing separate to configure for that second channel.

The refresh-token replay (browser cookie pasted into sync/reports) still
works unchanged for anyone who hasn't switched over.

## Rate limiting

A global `ThrottlerGuard` (`@nestjs/throttler`) applies to every route —
300 requests/minute by default, comfortably above legitimate polling even
with several pages/tabs open at once. `AuthController`/`OauthController`
carry a much stricter override (20/minute) of their own: those are the
genuinely low-frequency, brute-forceable routes (refresh-token rotation,
API-key creation, OAuth login), never anything worker/chat poll.
`JwtOrApiKeyGuard` routes deliberately stay on the looser app-wide default,
since that's where the real polling traffic lives.

The VPN endpoints that push GitHub Actions secrets / trigger a redeploy
(`POST /api/v1/vpn/sync`, `/worker-secrets`, `/provision`) carry their own
even-stricter throttle (10/minute) plus a required `confirm: true` body
field and an audit log line naming who triggered them
(IMPROVEMENTS_TECH.md 1.4) — notably, neither of those actually mitigates a
*compromised bridge backend process* reading `BRIDGE_GITHUB_TOKEN` directly
from its own environment; that would need moving these endpoints out of
bridge's backend entirely (a separate service or GitHub App with minimal
scope), which hasn't been done.
