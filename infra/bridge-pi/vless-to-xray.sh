#!/usr/bin/env bash
#
# Builds ~/.pipe/xray-client.json (the Xray client config deploy-worker.sh needs) from a vless:// Reality link —
# the link your VPN panel, the VPN page in bridge ("copy connection link") or a VPN app on your phone gives you —
# or from a sing-box style JSON (an `outbounds` entry with type "vless", server, uuid, tls.reality…) as exported by
# some VPN apps.
# The link carries the server's address, your client UUID and the Reality keys, so it is a secret: it is read
# with a hidden prompt (or from a file) and never echoed.
#
#   ./vless-to-xray.sh                  # paste the link, press Enter (nothing is shown)
#   ./vless-to-xray.sh link.txt         # or read it from a file (a vless:// link or a sing-box JSON)
#
# A file with SEVERAL vless:// links (one per line; blank lines and lines starting with # are skipped) makes a POOL: one outbound
# per link (node-1 … node-N), Xray probes each exit through itself once a minute (observatory) and a leastPing balancer sends the
# traffic to the fastest one that answers, falling back to node-1 when every probe fails — so a blocked exit is left on its own.
# One link gives the plain single-outbound config, as before. (Telegram, GitHub and the like go through this proxy.)
#
# FINGERPRINT=firefox ./vless-to-xray.sh …   overrides the TLS fingerprint the link/JSON carries. On this network the
# `chrome` fingerprint was throttled (about 80% of connections hung, in series) while `firefox` passed 48 of 48 — if
# the tunnel is flaky, try another one (firefox, safari, randomized) before blaming the server.
#
# The result is the same shape as bridge/deploy/swarm/xray-client-config.example.json: an HTTP proxy on :1080 inside
# the worker network (HTTP, not SOCKS — the claude CLI and undici cannot use SOCKS5) and one VLESS+Reality outbound.
set -euo pipefail

OUT="${OUT:-$HOME/.pipe/xray-client.json}"
if [ -n "${1:-}" ]; then
  LINK="$(cat "$1")"
else
  printf 'vless:// link (hidden): ' >&2
  read -rs LINK; echo >&2
fi
[ -n "$(printf '%s' "$LINK" | tr -d '[:space:]')" ] || { echo "empty link" >&2; exit 1; }

umask 077
mkdir -p "$(dirname "$OUT")"
LINK="$LINK" OUT="$OUT" python3 - <<'PY'
import json, os, sys
from urllib.parse import urlsplit, parse_qs, unquote

raw = os.environ['LINK'].strip()
fingerprint_override = os.environ.get('FINGERPRINT')

def need(q, key):
    if not q.get(key):
        sys.exit(f'the link has no "{key}" — it must be a Reality link (security=reality, pbk, sni, fp, sid)')
    return q[key]

def from_json(raw):
    # sing-box style: {"outbounds": [{"type": "vless", "server", "server_port", "uuid", "flow", "tls": {...}}]}
    try:
        doc = json.loads(raw)
    except ValueError as e:
        sys.exit(f'not valid JSON: {e}')
    outs = [o for o in doc.get('outbounds', []) if o.get('type') == 'vless']
    if not outs:
        sys.exit('no vless outbound in the JSON')
    o = outs[0]
    tls = o.get('tls') or {}
    reality = tls.get('reality') or {}
    if not (tls.get('enabled') and reality.get('enabled')):
        sys.exit('the JSON outbound is not TLS+Reality')
    if (o.get('transport') or {}).get('type', 'tcp') != 'tcp':
        sys.exit('only the tcp transport is supported here')
    host, port, uuid = o.get('server'), o.get('server_port', 443), o.get('uuid')
    if not (host and uuid):
        sys.exit('the JSON outbound has no server/uuid')
    q = {'flow': o.get('flow', ''), 'encryption': 'none',
         'sni': tls.get('server_name', ''), 'fp': (tls.get('utls') or {}).get('fingerprint', 'chrome'),
         'pbk': reality.get('public_key', ''), 'sid': reality.get('short_id', ''), 'spx': '/'}
    return host, port, uuid, q

def from_link(line):
    u = urlsplit(line)
    if u.scheme != 'vless' or not u.hostname or not u.username:
        sys.exit('not a vless:// link (vless://UUID@host:port?...) and not a JSON')
    q = {k: unquote(v[0]) for k, v in parse_qs(u.query).items()}
    if q.get('security') != 'reality':
        sys.exit('the link is not security=reality')
    if q.get('type', 'tcp') != 'tcp':
        sys.exit(f'transport "{q.get("type")}" is not supported here — only tcp')
    return u.hostname, u.port or 443, unquote(u.username), q

def outbound(host, port, uuid, q, tag=None):
    out = {
        'protocol': 'vless',
        'settings': {'vnext': [{
            'address': host,
            'port': port,
            'users': [{'id': uuid, 'encryption': q.get('encryption', 'none'),
                       **({'flow': q['flow']} if q.get('flow') else {})}],
        }]},
        'streamSettings': {
            'network': 'tcp',
            'security': 'reality',
            'realitySettings': {
                'serverName': need(q, 'sni'),
                'fingerprint': fingerprint_override or q.get('fp', 'chrome'),
                'publicKey': need(q, 'pbk'),
                'shortId': q.get('sid', ''),
                'spiderX': q.get('spx', '/'),
            },
        },
    }
    if tag:
        out = {'tag': tag, **out}
    return out

if raw.startswith('{'):
    links = [from_json(raw)]
else:
    lines = [l.strip() for l in raw.splitlines() if l.strip() and not l.strip().startswith('#')]
    if not lines:
        sys.exit('empty link')
    links = [from_link(l) for l in lines]

if len(links) == 1:
    host, port, uuid, q = links[0]
    cfg = {
        'log': {'loglevel': 'warning'},
        'inbounds': [{'listen': '0.0.0.0', 'port': 1080, 'protocol': 'http'}],
        'outbounds': [outbound(host, port, uuid, q)],
    }
    summary = f'server {host}:{port}, sni {q["sni"]}'
else:
    cfg = {
        'log': {'loglevel': 'warning'},
        'inbounds': [{'tag': 'in', 'listen': '0.0.0.0', 'port': 1080, 'protocol': 'http'}],
        'outbounds': [outbound(h, p, u, q, f'node-{i + 1}') for i, (h, p, u, q) in enumerate(links)],
        'observatory': {'subjectSelector': ['node-'], 'probeUrl': 'https://www.gstatic.com/generate_204',
                        'probeInterval': '1m', 'enableConcurrency': True},
        'routing': {
            'domainStrategy': 'AsIs',
            'balancers': [{'tag': 'pool', 'selector': ['node-'], 'strategy': {'type': 'leastPing'}, 'fallbackTag': 'node-1'}],
            'rules': [{'type': 'field', 'inboundTag': ['in'], 'balancerTag': 'pool'}],
        },
    }
    summary = f'pool of {len(links)}: ' + ', '.join(f'{h}:{p}' for h, p, _, _ in links)

with open(os.environ['OUT'], 'w') as f:
    json.dump(cfg, f, indent=2)
    f.write('\n')
os.chmod(os.environ['OUT'], 0o600)
print(f"wrote {os.environ['OUT']} ({summary})")
PY
