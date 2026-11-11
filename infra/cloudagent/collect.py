#!/usr/bin/env python3
"""Collects what the Dashboard's «Облако (VM)» tile shows and prints it as one JSON document (the body of POST /api/v1/boards/agent/cloud).

Read-only: it asks Docker, `ss`, `curl` and a few files, never changes anything. Settings come from the environment (report.sh sources
/etc/pipe-cloudagent.env); every one is optional:

  CLOUD_HOST       name shown in the Dashboard (default: hostname)
  CRITICAL_REGEX   Swarm services whose name matches are critical (default: ^(bridge_|bridge-pg))
  CONTAINERS       plain containers to watch, "name[:opt] ..." — critical unless ":opt" (e.g. "postgres bridge-pg pgadmin-4:opt")
  PROBES           "url|critical ..." answered by curl: critical is 1 or 0 (e.g. "https://api.bridge.ntlstl.dev/api/v1/health|1")
  EXPOSED_CHECK    ports that must not listen on every interface (default: 5432)
  BACKUP_FILES     "name=path ..." — the age of a backup is the age of that file (e.g. "bridge=/srv/backups/bridge/latest/meta.env")
  CERT_FILES       "name=path ..." — days left of a PEM certificate
  REPL_CONTAINER   Postgres container whose pg_stat_replication tells the lag of the standby (REPL_USER, default postgres)
  LEADER_FILE      a file holding "<site> <epoch>" (written by the leader mechanism, when there is one)
  VERSION_FILE     a file whose first word is the commit the stack runs
  PROC_DIR         where /proc is (a test hook)

Python 3 standard library only.
"""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time

PROC = os.environ.get("PROC_DIR", "/proc")
NOW = time.time()


def setting(name, default=""):
    return os.environ.get(name, default)


def run(args, timeout=25):
    """stdout of a command, or None when it failed or is not there."""
    try:
        done = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout, universal_newlines=True)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return done.stdout if done.returncode == 0 else None


def read(path):
    try:
        with open(path) as handle:
            return handle.read()
    except OSError:
        return None


def pairs(raw):
    """"a=1 b=2" -> [("a", "1"), ("b", "2")]; a word without "=" is skipped."""
    found = []
    for word in raw.split():
        name, sep, value = word.partition("=")
        if sep and name and value:
            found.append((name, value))
    return found


# --------------------------------------------------------------------------- the host

def memory():
    values = {}
    for line in (read(os.path.join(PROC, "meminfo")) or "").splitlines():
        name, _, rest = line.partition(":")
        match = re.match(r"\s*(\d+)", rest)
        if match:
            values[name] = int(match.group(1)) // 1024  # kB -> MB
    if "MemTotal" not in values:
        return None
    swap_total = values.get("SwapTotal", 0)
    return {
        "totalMb": values["MemTotal"],
        "availableMb": values.get("MemAvailable", values.get("MemFree", 0)),
        "swapTotalMb": swap_total,
        "swapUsedMb": max(0, swap_total - values.get("SwapFree", swap_total)),
    }


def uptime_sec():
    try:
        return int(float((read(os.path.join(PROC, "uptime")) or "").split()[0]))
    except (IndexError, ValueError):
        return 0


def load5():
    try:
        return float((read(os.path.join(PROC, "loadavg")) or "").split()[1])
    except (IndexError, ValueError):
        return None


def disk():
    usage = shutil.disk_usage(setting("DISK_PATH", "/"))
    return {"totalBytes": usage.total, "usedBytes": usage.used}


# --------------------------------------------------------------------------- Docker

SIZE = {"b": 1 / 1048576, "kib": 1 / 1024, "kb": 1 / 1000, "mib": 1, "mb": 1, "gib": 1024, "gb": 1000}


def mem_mb(text):
    """"118.3MiB / 1.917GiB" -> 118."""
    match = re.match(r"\s*([\d.]+)\s*([A-Za-z]+)", text or "")
    if not match or match.group(2).lower() not in SIZE:
        return None
    return int(round(float(match.group(1)) * SIZE[match.group(2).lower()]))


def health_of(status):
    if "(unhealthy)" in status:
        return "unhealthy"
    if "(healthy)" in status:
        return "healthy"
    if "(health: starting)" in status:
        return "starting"
    return "none"


def service_of(container):
    """A Swarm task is named service.N.id; a plain container is its own service."""
    return container.split(".")[0] if "." in container else container


UNITS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400, "week": 604800, "month": 2592000}


def age_sec(text):
    """"5 minutes", "about an hour", "less than a second" -> seconds; None when it cannot be read."""
    text = text.strip().lower()
    if text.startswith("less than"):
        return 0
    match = re.match(r"(?:about\s+)?(an?|\d+)\s+(second|minute|hour|day|week|month)s?$", text)
    if not match:
        return None
    count = 1 if match.group(1) in ("a", "an") else int(match.group(1))
    return count * UNITS[match.group(2)]


def restarts_24h(service):
    out = run(["docker", "service", "ps", service, "--format", "{{.CurrentState}}"])
    count = 0
    for line in (out or "").splitlines():
        match = re.match(r"(Failed|Rejected)\s+(.*)\s+ago\s*$", line.strip())
        if match:
            age = age_sec(match.group(2))
            if age is not None and age <= 86400:
                count += 1
    return count


def services():
    """Swarm services + the plain containers named in CONTAINERS. Docker itself not answering is a finding, not silence."""
    listing = run(["docker", "service", "ls", "--format", "{{.Name}}|{{.Replicas}}"])
    containers_wanted = [word.partition(":") for word in setting("CONTAINERS").split()]
    ps = run(["docker", "ps", "-a", "--format", "{{.Names}}|{{.State}}|{{.Status}}"])
    if listing is None and ps is None:
        return [{"name": "docker", "desired": 1, "running": 0, "critical": True}]

    stats = {}
    for line in (run(["docker", "stats", "--no-stream", "--format", "{{.Name}}|{{.MemUsage}}"]) or "").splitlines():
        name, _, usage = line.partition("|")
        mb = mem_mb(usage)
        if mb is not None:
            stats[service_of(name)] = stats.get(service_of(name), 0) + mb

    health = {}
    state = {}
    for line in (ps or "").splitlines():
        name, _, rest = line.partition("|")
        container_state, _, status = rest.partition("|")
        key = service_of(name)
        state[name] = container_state
        found = health_of(status)
        # The worst of a service's tasks wins.
        order = ["none", "healthy", "starting", "unhealthy"]
        if key not in health or order.index(found) > order.index(health[key]):
            health[key] = found

    critical = re.compile(setting("CRITICAL_REGEX", r"^(bridge_|bridge-pg)"))
    result = []
    for line in (listing or "").splitlines():
        name, _, replicas = line.partition("|")
        match = re.match(r"(\d+)/(\d+)", replicas)
        if not name or not match:
            continue
        entry = {
            "name": name,
            "desired": int(match.group(2)),
            "running": int(match.group(1)),
            "health": health.get(name, "none"),
            "restarts24h": restarts_24h(name),
            "critical": bool(critical.search(name)),
        }
        if name in stats:
            entry["memMb"] = stats[name]
        result.append(entry)

    for name, _, opt in containers_wanted:
        running = 1 if state.get(name) == "running" else 0
        entry = {"name": name, "desired": 1, "running": running, "health": health.get(name, "none"), "critical": opt != "opt"}
        if name in stats:
            entry["memMb"] = stats[name]
        result.append(entry)

    return result


# --------------------------------------------------------------------------- probes and checks

def probes():
    result = []
    for word in setting("PROBES").split():
        url, _, crit = word.rpartition("|")
        if not url:
            url, crit = word, "0"
        out = run(["curl", "-s", "-o", "/dev/null", "--max-time", "10", "-w", "%{http_code} %{time_total}", url], timeout=15)
        code = None
        ms = None
        if out:
            parts = out.split()
            try:
                code = int(parts[0]) or None
                # curl prints "000 0.000" when nothing answered: no code, and a time that means nothing.
                ms = int(round(float(parts[1]) * 1000)) if code is not None else None
            except (IndexError, ValueError):
                pass
        entry = {"name": url, "ok": code is not None and 200 <= code < 400, "critical": crit == "1"}
        if code is not None:
            entry["httpCode"] = code
        if ms is not None:
            entry["ms"] = ms
        result.append(entry)
    return result


def exposed_ports():
    wanted = {int(port) for port in setting("EXPOSED_CHECK", "5432").split() if port.isdigit()}
    found = set()
    for line in (run(["ss", "-ltnH"]) or "").splitlines():
        columns = line.split()
        if len(columns) < 4:
            continue
        address, _, port = columns[3].rpartition(":")
        if port.isdigit() and int(port) in wanted and address in ("0.0.0.0", "*", "[::]", "::"):
            found.add(int(port))
    return sorted(found)


def backups():
    result = []
    for name, path in pairs(setting("BACKUP_FILES")):
        try:
            result.append({"name": name, "ageHours": round((NOW - os.path.getmtime(path)) / 3600, 1)})
        except OSError:
            result.append({"name": name, "ageHours": None})
    return result


def certs():
    result = []
    for name, path in pairs(setting("CERT_FILES")):
        out = run(["openssl", "x509", "-enddate", "-noout", "-in", path])
        match = re.search(r"notAfter=(.+)", out or "")
        if not match:
            continue
        try:
            end = time.mktime(time.strptime(match.group(1).strip(), "%b %d %H:%M:%S %Y %Z"))
        except ValueError:
            continue
        result.append({"name": name, "days": int((end - NOW) // 86400)})
    return result


def replication():
    container = setting("REPL_CONTAINER")
    if not container:
        return None
    query = "select count(*), coalesce(round(extract(epoch from max(replay_lag))::numeric, 1), 0) from pg_stat_replication where state = 'streaming'"
    out = run(["docker", "exec", container, "psql", "-U", setting("REPL_USER", "postgres"), "-Atc", query])
    try:
        count, lag = (out or "").strip().split("|")
        return {"connected": int(count) > 0, "lagSec": float(lag) if int(count) > 0 else None}
    except ValueError:
        # Postgres itself not answering: the standby is certainly not being fed.
        return {"connected": False, "lagSec": None}


def first_words(path, count):
    words = (read(path) or "").split()
    return words[:count] if len(words) >= count else None


def main():
    mem = memory()
    if mem is None:
        sys.stderr.write("cannot read %s/meminfo\n" % PROC)
        return 1

    report = {
        "host": setting("CLOUD_HOST") or socket.gethostname(),
        "uptimeSec": uptime_sec(),
        "cpus": os.cpu_count() or 1,
        "load5": load5(),
        "memory": mem,
        "disk": disk(),
        "services": services(),
        "probes": probes(),
        "exposedPorts": exposed_ports(),
        "backups": backups(),
        "certs": certs(),
    }
    repl = replication()
    if repl is not None:
        report["replication"] = repl
    leader = first_words(setting("LEADER_FILE"), 2) if setting("LEADER_FILE") else None
    if leader and leader[1].isdigit():
        report["leader"] = {"site": leader[0], "epoch": int(leader[1])}
    version = first_words(setting("VERSION_FILE"), 1) if setting("VERSION_FILE") else None
    if version:
        report["version"] = version[0][:64]

    json.dump(report, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
