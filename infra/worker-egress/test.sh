#!/usr/bin/env bash
# Tests for worker-egress.sh against a fake iptables that keeps its chains in a JSON file and a fake docker.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/worker-egress.sh"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
pass=0; fail=0
check() { if [ "$2" = 0 ]; then echo "ok   $1"; pass=$((pass + 1)); else echo "FAIL $1"; fail=$((fail + 1)); fi; }

cat > "$T/bin/iptables" <<'PY'
#!/usr/bin/env python3
import json, os, sys
path = os.environ["FAKE_IPT"]
state = json.load(open(path)) if os.path.exists(path) else {"INPUT": [], "DOCKER-USER": []}
def save(): json.dump(state, open(path, "w"))
a = sys.argv[1:]
op, chain, rest = a[0], a[1], a[2:]
line = " ".join(rest)
if op == "-N":
    if chain in state: sys.exit(1)
    state[chain] = []; save(); sys.exit(0)
if chain not in state and op != "-X": sys.exit(1)
if op == "-F": state[chain] = []; save(); sys.exit(0)
if op == "-X": state.pop(chain, None); save(); sys.exit(0)
if op == "-A": state[chain].append(line); save(); sys.exit(0)
if op == "-I":
    state[chain].insert(0, line); save(); sys.exit(0)
if op == "-C": sys.exit(0 if line in state[chain] else 1)
if op == "-D":
    if line not in state[chain]: sys.exit(1)
    state[chain].remove(line); save(); sys.exit(0)
if op == "-S":
    print("-N " + chain)
    for r in state[chain]: print("-A " + chain + " " + r)
    sys.exit(0)
if op == "-vnxL":
    print("Chain %s (2 references)" % chain); print("    pkts      bytes target     prot opt in     out     source               destination")
    for r in state[chain]:
        if "REJECT" in r:
            dst = r.split("-d ")[1].split()[0]
            print("      %d          0 REJECT     all  --  *      *       0.0.0.0/0            %s" % (7 if dst.startswith("192.168") else 0, dst))
    sys.exit(0)
sys.exit(2)
PY
chmod +x "$T/bin/iptables"
export FAKE_IPT="$T/ipt.json" IPTABLES="$T/bin/iptables" PATH="$T/bin:$PATH" EGRESS_SUBNET=172.17.0.0/16 EGRESS_IFACE=docker0

run() { bash "$SCRIPT" "$@" 2>&1; }
rules() { python3 -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1]))[sys.argv[2]]))' "$FAKE_IPT" "$1"; }

echo "# apply"
run apply >/dev/null; check "apply: succeeds" $?
rules DOCKER-USER | grep -qx -- '-s 172.17.0.0/16 -j PIPE-WORKER-EGRESS'; check "apply: DOCKER-USER sends the workers' traffic through the chain" $?
rules INPUT | grep -qx -- '-i docker0 -s 172.17.0.0/16 -j PIPE-WORKER-EGRESS'; check "apply: INPUT does the same for traffic to the board itself" $?
for net in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10; do
  rules PIPE-WORKER-EGRESS | grep -q -- "-d $net -j REJECT --reject-with icmp-admin-prohibited"; check "apply: $net is refused" $?
done
[ "$(rules PIPE-WORKER-EGRESS | head -1 | grep -c ESTABLISHED)" = 1 ]; check "apply: replies to connections that came in pass first" $?
rules PIPE-WORKER-EGRESS | grep -q -- '-d 0.0.0.0/0'; [ $? -ne 0 ]; check "apply: the public internet is not mentioned, so it passes" $?

echo "# idempotence"
before="$(cat "$FAKE_IPT")"
run apply | grep -q "already in place"; check "apply twice: says nothing changed" $?
[ "$(cat "$FAKE_IPT")" = "$before" ]; check "apply twice: the rules are byte for byte the same" $?
[ "$(rules DOCKER-USER | grep -c PIPE-WORKER-EGRESS)" = 1 ] && [ "$(rules INPUT | grep -c PIPE-WORKER-EGRESS)" = 1 ]; check "apply twice: each hook exists exactly once" $?

echo "# check"
run check >/dev/null; check "check: 0 when in place" $?
python3 - "$FAKE_IPT" <<'PY'
import json, sys
s = json.load(open(sys.argv[1])); s["DOCKER-USER"] = []; json.dump(s, open(sys.argv[1], "w"))
PY
run check >/dev/null; [ $? -eq 1 ]; check "check: 1 when something flushed a hook" $?
run apply >/dev/null; run check >/dev/null; check "apply heals it, and check is 0 again" $?
python3 - "$FAKE_IPT" <<'PY'
import json, sys
s = json.load(open(sys.argv[1])); s["PIPE-WORKER-EGRESS"].pop(); json.dump(s, open(sys.argv[1], "w"))
PY
run check >/dev/null; [ $? -eq 1 ]; check "check: 1 when a rule of the chain is missing" $?
run apply >/dev/null; run check >/dev/null; check "apply restores a missing rule" $?

echo "# settings"
EGRESS_ALLOW="192.168.50.5/32" run apply >/dev/null
rules PIPE-WORKER-EGRESS | grep -q -- '-d 192.168.50.5/32 -j RETURN'; check "allow: an exception is added" $?
[ "$(rules PIPE-WORKER-EGRESS | grep -n -- '-d 192.168.50.5/32' | cut -d: -f1)" -lt "$(rules PIPE-WORKER-EGRESS | grep -n -- '-d 192.168.0.0/16' | cut -d: -f1)" ]; check "allow: the exception comes before the refusal it excepts from" $?
EGRESS_ALLOW="192.168.50.5/32" run check >/dev/null; check "allow: check agrees with the settings it is given" $?
run check >/dev/null; [ $? -eq 1 ]; check "allow: check says no when the settings differ from what is installed" $?
run apply >/dev/null
rules PIPE-WORKER-EGRESS | grep -q -- '192.168.50.5'; [ $? -ne 0 ]; check "allow: dropping the setting drops the exception" $?

echo "# status"
out="$(run status)"
grep -q "in place" <<< "$out" && grep -q "refused 7 packet(s) to 192.168.0.0/16" <<< "$out"; check "status: says it is in place and what was refused" $?

echo "# remove"
run remove >/dev/null; check "remove: succeeds" $?
[ -z "$(rules DOCKER-USER)" ] && [ -z "$(rules INPUT)" ]; check "remove: both hooks are gone" $?
python3 -c 'import json,sys; sys.exit(0 if "PIPE-WORKER-EGRESS" not in json.load(open(sys.argv[1])) else 1)' "$FAKE_IPT"; check "remove: the chain is gone" $?
run remove >/dev/null; check "remove twice: no complaint" $?
run check >/dev/null; [ $? -eq 1 ]; check "check: 1 after remove" $?

echo "# docker is not running"
rm -f "$FAKE_IPT"; echo '{"INPUT": []}' > "$FAKE_IPT"
out="$(run apply)"; [ $? -ne 0 ] && grep -q "no DOCKER-USER chain" <<< "$out"; check "apply: says so when there is no DOCKER-USER chain, and changes nothing" $?
[ "$(rules INPUT)" = "" ]; check "apply: ...nothing hooked" $?

echo "# verify"
rm -f "$FAKE_IPT"
cat > "$T/bin/docker" <<'SH'
#!/usr/bin/env bash
case "$1" in
  ps) echo pipe-worker-pi-red ;;
  inspect) echo ghcr.io/bmazurme/pipe-worker:stable ;;
  network) echo 172.17.0.0/16 ;;
  run) cat "$FAKE_PROBE" ;;
esac
SH
cat > "$T/bin/ip" <<'SH'
#!/usr/bin/env bash
case "$*" in
  route) echo "default via 192.168.50.1 dev eth0" ;;
  *) echo "2: eth0    inet 192.168.50.12/24 brd 192.168.50.255 scope global eth0" ;;
esac
SH
chmod +x "$T/bin/docker" "$T/bin/ip"
export FAKE_PROBE="$T/probe"
printf '192.168.50.1:80 EHOSTUNREACH\n192.168.50.12:22 EHOSTUNREACH\n1.1.1.1:443 connected\n' > "$FAKE_PROBE"
run verify >/dev/null; check "verify: passes when the LAN is refused and the internet is open" $?
printf '192.168.50.1:80 connected\n192.168.50.12:22 EHOSTUNREACH\n1.1.1.1:443 connected\n' > "$FAKE_PROBE"
out="$(run verify)"; [ $? -ne 0 ] && grep -q "router is reachable" <<< "$out"; check "verify: fails, saying so, when a container reaches the router" $?
printf '192.168.50.1:80 ECONNREFUSED\n192.168.50.12:22 EHOSTUNREACH\n1.1.1.1:443 connected\n' > "$FAKE_PROBE"
run verify >/dev/null; [ $? -ne 0 ]; check "verify: a closed port (RST) is not a block — the packet got there" $?
printf '192.168.50.1:80 EHOSTUNREACH\n192.168.50.12:22 connected\n1.1.1.1:443 connected\n' > "$FAKE_PROBE"
out="$(run verify)"; [ $? -ne 0 ] && grep -q "board itself" <<< "$out"; check "verify: fails when a container reaches the board's own sshd" $?
printf '192.168.50.1:80 EHOSTUNREACH\n192.168.50.12:22 EHOSTUNREACH\n1.1.1.1:443 TIMEOUT\n' > "$FAKE_PROBE"
out="$(run verify)"; [ $? -ne 0 ] && grep -q "internet is NOT reachable" <<< "$out"; check "verify: fails when the filter also cuts the internet" $?

echo
echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
