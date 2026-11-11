#!/usr/bin/env python3
"""Probes the VPN channels from THIS machine and tells bridge what it found (the Dashboard's «Каналы связи» tile).

A channel is a host:port a link of some connection points at. bridge says which ones (GET /api/v1/boards/agent/channels: host, port
and the SNI of the link, never a key); for each this makes a connection the way a client would — TCP, then a TLS handshake with that
SNI, certificate not checked (a Reality server answers with the real site's certificate; a handshake that completes means the server is
there and is not filtering this machine) — and notes how far it got. The same method as bridge's own probe (links/link-probe.ts),
so a cell of the matrix means the same from every vantage point:

  ok            handshake completed (tcp + tls times)
  tcp_timeout   no answer to the SYN — the address or port is filtered on the way
  tcp_refused   RST on the SYN — the port is closed
  tls_timeout   connected, then silence — throttling
  tls_reset     reset after the connection was made — what DPI does
  tls_error     the peer closed or answered something that is not TLS
  error         anything else (no route, …)

Settings (the environment; report.sh-style files are read by run.sh / the systemd unit):
  BRIDGE_API_URL   one or SEVERAL bridge addresses, separated by spaces or commas — tried in order, so a vantage point in a network that
                   blocks one of them still reports through another (https://api.bridge.ntlstl.dev https://api2.example.org)
  BRIDGE_API_KEY   a boards-only key of the OWNER (bridge: Профиль → API-ключи → «только для плат»)
  VANTAGE          the name of this place in the tile (default: the hostname)
  PROBE_TIMEOUT    seconds for one whole attempt (default 6)

Nothing is changed on this machine. Python 3 standard library only. Exits 0 even when bridge cannot be reached: bridge shows a point that
stopped reporting as «не присылает пробы» by itself.
"""
import json
import os
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

CONCURRENCY = 4


def log(message):
    sys.stderr.write("[%s] %s\n" % (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), message))


def classify(stage, error, timed_out):
    """(result, detail) for a connection that did not complete; stage is 'tcp' or 'tls'."""
    code = getattr(error, "errno", None)
    name = type(error).__name__ if error is not None else None
    detail = (name + (":%s" % code if code else "")) if name else None

    if stage == "tcp":
        if timed_out:
            return "tcp_timeout", detail
        if isinstance(error, ConnectionRefusedError):
            return "tcp_refused", detail
        return "error", detail

    if timed_out:
        return "tls_timeout", detail
    if isinstance(error, (ConnectionResetError, BrokenPipeError)):
        return "tls_reset", detail
    return "tls_error", detail


def probe(host, port, sni, timeout):
    """One attempt: {'result', 'tcpMs', 'tlsMs', 'detail'}. The timeout is the wall clock of the whole attempt."""
    started = time.monotonic()
    deadline = started + timeout
    sock = None
    tcp_ms = None

    def left():
        return max(0.05, deadline - time.monotonic())

    try:
        try:
            sock = socket.create_connection((host, port), timeout=left())
        except socket.timeout as error:
            result, detail = classify("tcp", error, True)
            return {"result": result, "tcpMs": None, "tlsMs": None, "detail": detail}
        except OSError as error:
            result, detail = classify("tcp", error, False)
            return {"result": result, "tcpMs": None, "tlsMs": None, "detail": detail}

        connected = time.monotonic()
        tcp_ms = int(round((connected - started) * 1000))
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        sock.settimeout(left())

        try:
            tls = context.wrap_socket(sock, server_hostname=sni or None)
            tls.close()
            sock = None
        except socket.timeout as error:
            result, detail = classify("tls", error, True)
            return {"result": result, "tcpMs": tcp_ms, "tlsMs": None, "detail": detail}
        except (OSError, ssl.SSLError, EOFError) as error:
            result, detail = classify("tls", error, False)
            return {"result": result, "tcpMs": tcp_ms, "tlsMs": None, "detail": detail}

        return {"result": "ok", "tcpMs": tcp_ms, "tlsMs": int(round((time.monotonic() - connected) * 1000)), "detail": None}
    finally:
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass


def addresses(raw):
    return [part for part in raw.replace(",", " ").split() if part.startswith(("http://", "https://"))]


def request(base, path, key, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base.rstrip("/") + path, data=data, method="GET" if body is None else "POST")
    req.add_header("Authorization", "Bearer " + key)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=20) as response:
        raw = response.read()
    return json.loads(raw) if raw else None


def main():
    bases = addresses(os.environ.get("BRIDGE_API_URL", ""))
    key = os.environ.get("BRIDGE_API_KEY", "")
    vantage = os.environ.get("VANTAGE") or socket.gethostname()
    timeout = float(os.environ.get("PROBE_TIMEOUT") or 6)

    if not bases or not key:
        log("BRIDGE_API_URL / BRIDGE_API_KEY are not set — nothing probed")
        return 0

    # The first bridge address that answers gives the list of channels; the report goes to the same one.
    channels = None
    base_used = None
    for base in bases:
        try:
            channels = request(base, "/api/v1/boards/agent/channels", key)
            base_used = base
            break
        except (urllib.error.URLError, OSError, ValueError) as error:
            log("bridge %s did not answer (%s)" % (base.split("//", 1)[-1].split("/", 1)[0], error))

    if channels is None:
        log("no bridge address answered — nothing reported")
        return 0

    channels = [c for c in channels if isinstance(c, dict) and c.get("host") and c.get("port") and c.get("key")]
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        outcomes = list(pool.map(lambda c: probe(c["host"], int(c["port"]), c.get("sni") or "", timeout), channels))

    results = []
    for channel, outcome in zip(channels, outcomes):
        entry = {"key": channel["key"], "result": outcome["result"]}
        for field in ("tcpMs", "tlsMs", "detail"):
            if outcome[field] is not None:
                entry[field] = outcome[field]
        results.append(entry)

    try:
        request(base_used, "/api/v1/boards/agent/links", key, {"vantage": vantage, "results": results})
    except (urllib.error.URLError, OSError, ValueError) as error:
        log("could not report to bridge (%s)" % error)
    return 0


if __name__ == "__main__":
    sys.exit(main())
