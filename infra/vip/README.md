# infra/vip — one floating address for the bridge stack

Today the router forwards 80/443 to **one board** (white). After a failover somebody has to change that rule by hand. With a floating
address the router is set **once**, to `192.168.50.10`, and the address itself follows the stack:

```
internet → router (80/443 → 192.168.50.10) → whichever board runs Caddy
                                                white (.11)   red (.12)      keepalived (VRRP, unicast) on both
```

Caddy publishes 80/443 in **host mode** (`infra/bridge-pi/bridge-pi.yml`), so only the board that runs the Caddy task answers on them.
keepalived on each board runs `vip-check-caddy` every 5 s (is a `bridge_caddy` task running here?); a board without Caddy lowers its priority
by 50 and gives the address up, the other one takes it (gratuitous ARP) and Telegram says so. Preempt is on: the board whose Caddy runs (priority 100) always wins over the one without (50) — a board that merely comes back changes nothing, because both have 100 only when both run Caddy (never).

What this changes in a failover: `failover.sh` ends with Caddy starting on red → within ~10–15 s the address is on red → **no router step**.
White's death needs nothing from you except the failover itself. Without Caddy anywhere the address sits on a board that does not answer
80/443 — the same as an outage today.

## Set-up (once, no downtime)

1. Pick an address nobody uses and that is **outside the router's DHCP pool** (default `192.168.50.10`; check the pool in the router: LAN → DHCP Server).
   `install.sh` refuses an address that already answers.
2. On white: `sudo infra/vip/install.sh --peer 192.168.50.12 --dry-run` (prints the config), then without `--dry-run`.
3. On red: `sudo infra/vip/install.sh --peer 192.168.50.11`.
4. Check: `ip -4 addr show dev eth0 | grep 192.168.50.10` — exactly one board shows it (the one running Caddy: white).
   From your workstation `curl -k -I https://192.168.50.10 -H 'Host: bridge.ntlstl.dev'` answers.
5. Router: change the Virtual Server rules for 80 and 443 from `192.168.50.11` to `192.168.50.10`. Re-check the site from outside (a phone on mobile data).

Nothing else changes: DNS keeps pointing at the home address, the stack is untouched, keepalived only moves one IP.

## Limits (honest)

- Same L2 only: it protects against a **board** dying, not against the router, the switch or the provider.
- No VRRP authentication (the LAN is trusted; the option is deprecated in keepalived); anybody on the LAN could claim the address — the same
  anybody who could ARP-spoof the boards today.
- If the check script is wrong (docker hangs), a board can drop the address although Caddy is fine: then `systemctl stop keepalived` on the
  OTHER board is not needed — restart keepalived on the board that should hold it; the check runs again in 10 s.

## Rollback

`sudo systemctl disable --now keepalived` on both boards, router rule back to `192.168.50.11`.

## Tests

`docker run --rm -v "$PWD":/r debian:bookworm-slim bash /r/infra/vip/test.sh` (install.sh `--dry-run` with a fake `ip`/`ping`, the check and notify scripts).
