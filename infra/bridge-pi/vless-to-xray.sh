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
# The result is the same shape as bridge/deploy/swarm/xray-client-config.example.json: an HTTP proxy on :1080 inside
# the worker network (HTTP, not SOCKS — the claude CLI and undici cannot use SOCKS5) and one VLESS+Reality outbound.
set -euo pipefail

OUT="${OUT:-$HOME/.pipe/xray-client.json}"
if [ -n "${1:-}" ]; then
  LINK="$(tr -d '[:space:]' < "$1")"
else
  printf 'vless:// link (hidden): ' >&2
  read -rs LINK; echo >&2
fi
[ -n "$LINK" ] || { echo "empty link" >&2; exit 1; }

umask 077
mkdir -p "$(dirname "$OUT")"
LINK="$LINK" OUT="$OUT" python3 - <<'PY'
import json, os, sys
from urllib.parse import urlsplit, parse_qs, unquote

raw = os.environ['LINK'].strip()

def need(q, key):
    if not q.get(key):
        sys.exit(f'the link has no "{key}" — it must be a Reality link (security=reality, pbk, sni, fp, sid)')
    return q[key]

if raw.startswith('{'):
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
else:
    u = urlsplit(raw)
    if u.scheme != 'vless' or not u.hostname or not u.username:
        sys.exit('not a vless:// link (vless://UUID@host:port?...) and not a JSON')
    q = {k: unquote(v[0]) for k, v in parse_qs(u.query).items()}
    if q.get('security') != 'reality':
        sys.exit('the link is not security=reality')
    if q.get('type', 'tcp') != 'tcp':
        sys.exit(f'transport "{q.get("type")}" is not supported here — only tcp')
    host, port, uuid = u.hostname, u.port or 443, unquote(u.username)

cfg = {
    'log': {'loglevel': 'warning'},
    'inbounds': [{'listen': '0.0.0.0', 'port': 1080, 'protocol': 'http'}],
    'outbounds': [{
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
                'fingerprint': q.get('fp', 'chrome'),
                'publicKey': need(q, 'pbk'),
                'shortId': q.get('sid', ''),
                'spiderX': q.get('spx', '/'),
            },
        },
    }],
}
with open(os.environ['OUT'], 'w') as f:
    json.dump(cfg, f, indent=2)
    f.write('\n')
os.chmod(os.environ['OUT'], 0o600)
print(f"wrote {os.environ['OUT']} (server {host}:{port}, sni {q['sni']})")
PY
