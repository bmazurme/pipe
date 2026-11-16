# infra/linkprobe — the VPN channels as seen from here

The Dashboard's «Каналы связи» tile is a matrix: a row per **channel** (a `host:port` a link of some VPN connection points at), a column per
**vantage point** (a place that probes). One red cell in an otherwise green row is a server that is blocked *from there* and fine from
elsewhere — what happened to 95.81.127.173, which dropped TCP from home and from the cloud VM while it answered from other networks.
Without probes from several places that is guesswork.

```
bridge itself ──(every minute, no agent)──────────────┐
home Pi / cloud VM / laptop / hotel beacon            │
   probe.py ── GET  /api/v1/boards/agent/channels ──▶ bridge ──▶ «Каналы связи» (verdict, matrix, «Что требует внимания»)
            ── POST /api/v1/boards/agent/links ─────▶
```

bridge already probes every channel from where it runs (vantage point `bridge`; `LINK_PROBES=off` switches that off). This agent adds the
other places. It is **read-only**: it asks bridge which channels to probe — host, port and the SNI of the link, never a key — makes a
connection to each the way a client would (TCP, then a TLS handshake with that SNI; the certificate is not checked, a Reality server answers
with the real site's), and reports how far it got:

| result | meaning |
|---|---|
| `ok` | handshake completed (TCP and TLS times) |
| `tcp_timeout` | no answer to the SYN — the address or port is filtered on the way |
| `tcp_refused` | RST on the SYN — the port is closed |
| `tls_timeout` | connected, then silence — throttling |
| `tls_reset` | reset after the connection was made — what DPI does |
| `tls_error` | the peer closed or answered something that is not TLS |
| `error` | anything else (no route, …) |

Bridge's verdict (`bridge/apps/backend/src/links/links.ts`): a probe older than 5 minutes says nothing; a channel is **partial** when some
points reach it and some do not («не доходит из: …»), **down** when none does; **warn** when a channel is partial/down, when only one live
channel is left among several, or when a point stopped reporting; **bad** when no channel is reachable from any point.

## Install (on each place you want a column for)

```bash
scp -r infra/linkprobe USER@HOST:/tmp/ && ssh -t USER@HOST 'sudo bash /tmp/linkprobe/install.sh'
ssh -t USER@HOST 'sudoedit /etc/pipe-linkprobe.env'     # BRIDGE_API_KEY = a boards-only key of the OWNER; VANTAGE = a name that says where it is
ssh -t USER@HOST 'sudo systemctl start pipe-linkprobe.service && sudo journalctl -u pipe-linkprobe.service -n 5 --no-pager'
```

`BRIDGE_API_URL` may list **several** bridge addresses (space or comma separated); they are tried in order, so a place whose network blocks
one of them still reports through another. Without a key the probe does nothing and says so; with a bridge it cannot reach it exits 0 — bridge
shows a point that stopped reporting as «Точка … не присылает пробы» by itself. `install.sh --dry-run` shows what it would do; `--remove` takes
the probe away and leaves `/etc/pipe-linkprobe.env` (and the key in it) for you to delete.

## When bridge is slow

The channel-list request (`GET …/agent/channels`) and the report request (`POST …/agent/links`) each have a **fixed 20 s deadline**
(`urlopen(..., timeout=20)` in `probe.py`). It is not configurable and has nothing to do with `PROBE_TIMEOUT`, which is the per-channel
probe timeout (default 6 s). A request that times out or fails counts as «bridge did not answer»: the next `BRIDGE_API_URL` address is
tried, and if none answers the run exits 0 with «nothing reported». The point then reports nothing, and bridge shows it as «Точка …
не присылает пробы» only after 5 minutes (a probe older than that says nothing). So a slow channel list looks like a vantage point that
went missing, not like an error.

The list is slow most often when a connection's VPN panel is down: bridge resolves the links of every connection to build it
(`LinksService.channels`, `bridge/apps/backend/src/links/links.service.ts`), and each unreachable panel adds its own wait. Look at the
VPN page (connection status) first; a request that comes close to 20 s (bridge logs it as `http.slow` for
`/api/v1/boards/agent/channels`) is the sign the probe is about to give up.

Python 3 standard library only; any Linux with systemd. For a laptop or a phone-hotspot beacon the same `probe.py` can be run by hand or from cron
with the settings in the environment.

## Tests

`bash infra/linkprobe/test.sh` — real local sockets for each way a connection can end (refused, silent, not TLS, a real TLS handshake with the SNI
checked), the whole run against a fake bridge (several addresses, no key, an unreachable bridge, a refused key) and `install.sh` with a fake
`systemctl` (CI runs it).
