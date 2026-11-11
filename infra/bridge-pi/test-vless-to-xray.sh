#!/usr/bin/env bash
#
# Tests for vless-to-xray.sh (the vpn-client's Xray config): one link, a pool of several, a sing-box JSON, bad input.
# Nothing outside a temp directory is touched:  bash infra/bridge-pi/test-vless-to-xray.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/err" 2>/dev/null | head -8; fi; }

mk() { echo "vless://11111111-2222-3333-4444-55555555555$1@203.0.113.$1:443?type=tcp&security=reality&encryption=none&flow=xtls-rprx-vision&fp=chrome&sni=example.com&sid=ab$1&pbk=PUBKEY$1#n$1"; }
run() { OUT="$T/out.json" bash "$HERE/vless-to-xray.sh" "$@" > "$T/stdout" 2> "$T/err"; }
py() { python3 -c "import json,sys; c=json.load(open('$T/out.json')); $1"; }

# ---- one link: the plain config, the same shape as always
mk 1 > "$T/one.txt"
run "$T/one.txt"; code=$?
[ "$code" = 0 ] && grep -q "server 203.0.113.1:443, sni example.com" "$T/stdout"; check "one link: written, and says which server" $?
py "assert len(c['outbounds'])==1 and 'tag' not in c['outbounds'][0] and 'routing' not in c and 'observatory' not in c and 'tag' not in c['inbounds'][0]" 2>"$T/err"; check "one link: a plain config (one outbound, no tags, no balancer)" $?
py "assert c['inbounds']==[{'listen':'0.0.0.0','port':1080,'protocol':'http'}]; o=c['outbounds'][0]; assert o['settings']['vnext'][0]['address']=='203.0.113.1'; assert o['settings']['vnext'][0]['users'][0]['flow']=='xtls-rprx-vision'; assert o['streamSettings']['realitySettings']['publicKey']=='PUBKEY1'" 2>"$T/err"; check "one link: HTTP proxy on :1080, the link's own server and keys" $?
[ "$(stat -c %a "$T/out.json" 2>/dev/null || stat -f %Lp "$T/out.json")" = 600 ]; check "the config is mode 600 (it holds the keys)" $?

# ---- a pool
{ mk 1; echo; echo "# a note"; mk 2; echo "  $(mk 3)  "; } > "$T/pool.txt"
run "$T/pool.txt"; code=$?
[ "$code" = 0 ] && grep -q "pool of 3: 203.0.113.1:443, 203.0.113.2:443, 203.0.113.3:443" "$T/stdout"; check "several links: a pool, comments and blank lines skipped" $?
py "assert [o['tag'] for o in c['outbounds']]==['node-1','node-2','node-3']; assert [o['settings']['vnext'][0]['address'] for o in c['outbounds']]==['203.0.113.1','203.0.113.2','203.0.113.3']" 2>"$T/err"; check "pool: one outbound per link, in order, each with its own server" $?
py "assert c['observatory']['subjectSelector']==['node-'] and c['observatory']['probeInterval']=='1m' and c['observatory']['probeUrl'].startswith('https://')" 2>"$T/err"; check "pool: every exit is probed through itself" $?
py "b=c['routing']['balancers'][0]; assert b=={'tag':'pool','selector':['node-'],'strategy':{'type':'leastPing'},'fallbackTag':'node-1'}; assert c['routing']['rules']==[{'type':'field','inboundTag':['in'],'balancerTag':'pool'}]; assert c['inbounds'][0]['tag']=='in' and c['inbounds'][0]['port']==1080" 2>"$T/err"; check "pool: a leastPing balancer, node-1 as the fallback, fed from the proxy inbound" $?
py "assert [o['streamSettings']['realitySettings']['publicKey'] for o in c['outbounds']]==['PUBKEY1','PUBKEY2','PUBKEY3']" 2>"$T/err"; check "pool: each outbound keeps its own Reality keys" $?
FINGERPRINT=firefox OUT="$T/out.json" bash "$HERE/vless-to-xray.sh" "$T/pool.txt" >/dev/null 2>"$T/err"
py "assert {o['streamSettings']['realitySettings']['fingerprint'] for o in c['outbounds']}=={'firefox'}" 2>"$T/err"; check "FINGERPRINT applies to every outbound of the pool" $?

# ---- the prompt path (one link on stdin) and a sing-box JSON
printf '%s\n' "$(mk 4)" | OUT="$T/out.json" bash "$HERE/vless-to-xray.sh" >/dev/null 2>"$T/err"
py "assert c['outbounds'][0]['settings']['vnext'][0]['address']=='203.0.113.4'" 2>"$T/err"; check "a link pasted at the prompt still works" $?
cat > "$T/sb.json" <<'JSON'
{"outbounds":[{"type":"vless","server":"203.0.113.9","server_port":8443,"uuid":"u-9","flow":"xtls-rprx-vision","tls":{"enabled":true,"server_name":"example.org","utls":{"fingerprint":"firefox"},"reality":{"enabled":true,"public_key":"PK9","short_id":"cd"}}}]}
JSON
run "$T/sb.json"
py "o=c['outbounds'][0]; assert o['settings']['vnext'][0]['address']=='203.0.113.9' and o['settings']['vnext'][0]['port']==8443 and o['streamSettings']['realitySettings']['publicKey']=='PK9'" 2>"$T/err"; check "a sing-box JSON still works" $?

# ---- refusals, and nothing written
for case in "empty|" "not a link|hello" "wrong scheme|vmess://u@h:1?security=reality" "not reality|vless://u@h:1?security=tls&pbk=k&sni=s" "other transport|vless://u@h:1?security=reality&type=ws&pbk=k&sni=s" "no pbk|vless://u@h:1?security=reality&sni=s"; do
  name="${case%%|*}"; body="${case#*|}"; rm -f "$T/out.json"; printf '%s\n' "$body" > "$T/bad.txt"
  run "$T/bad.txt"; code=$?
  [ "$code" != 0 ] && [ ! -e "$T/out.json" ]; check "refuses: $name (and writes nothing)" $?
done
{ mk 1; echo "vless://u@h:1?security=tls&pbk=k&sni=s"; } > "$T/mixed.txt"; rm -f "$T/out.json"
run "$T/mixed.txt"; code=$?
[ "$code" != 0 ] && [ ! -e "$T/out.json" ]; check "a bad link among good ones refuses the whole file (a half pool would hide the mistake)" $?

echo; echo "$PASS passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
