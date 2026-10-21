"""The HTTP side of the add-in: localhost only, a bearer token, and every call to Fusion goes through a dispatcher.

Fusion's API may only be used on its main thread, and this server answers on its own threads — so a route does not call Fusion, it
hands a function to ``dispatcher.call(fn, timeout)`` and gets the answer back. Inside Fusion the dispatcher is a custom event (see
PipeFusion.py); in the tests it just calls the function.
"""

import hmac
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from script_runner import run_script

MAX_BODY_BYTES = 8 * 1024 * 1024
VIEWS = ("iso", "front", "back", "top", "bottom", "left", "right")
EXPORT_FORMATS = ("step", "stl", "f3d", "iges")
DEFAULT_RUN_TIMEOUT = 120
# The preferred local port, then any free one (port 0).
DEFAULT_PORT_FALLBACKS = (47615, 0)
MAX_RUN_TIMEOUT = 1800


class DispatchTimeout(Exception):
    """Fusion's main thread did not finish the work in time (the script may still be running there)."""


def make_server(port, token, dispatcher, ops):
    """``ops``: object with health(), info(), screenshot(view, width, height) -> bytes and export(fmt) -> bytes — run on Fusion's thread."""

    class Handler(BaseHTTPRequestHandler):
        server_version = "PipeFusion/1.0"

        def log_message(self, fmt, *args):  # no per-request noise in Fusion's console
            pass

        # ---- helpers
        def _send(self, status, body, content_type="application/json"):
            if isinstance(body, (dict, list)):
                body = json.dumps(body).encode("utf-8")
            elif isinstance(body, str):
                body = body.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _authorized(self):
            # A browser page can reach 127.0.0.1 too: refuse anything that carries an Origin or a foreign Host.
            if self.headers.get("Origin"):
                return False
            host = (self.headers.get("Host") or "").split(":")[0]
            if host not in ("127.0.0.1", "localhost"):
                return False
            given = self.headers.get("Authorization") or ""
            return hmac.compare_digest(given.encode("utf-8"), ("Bearer " + token).encode("utf-8"))

        def _body(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY_BYTES:
                raise ValueError("body too large")
            raw = self.rfile.read(length) if length else b""
            return json.loads(raw.decode("utf-8")) if raw else {}

        def _on_fusion(self, fn, timeout):
            try:
                return dispatcher.call(fn, timeout)
            except DispatchTimeout:
                self._send(504, {"error": "Fusion did not finish in %s s (a script may still be running there)" % timeout})
            except Exception as exc:  # an error of the operation itself, not of the request
                self._send(500, {"error": "%s: %s" % (type(exc).__name__, exc)})
            return None

        # ---- routes
        def do_GET(self):
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            if self.path == "/health":
                data = self._on_fusion(ops.health, 15)
                if data is not None:
                    self._send(200, dict(data, ok=True))
            elif self.path == "/info":
                data = self._on_fusion(ops.info, 30)
                if data is not None:
                    self._send(200, data)
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self):
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            try:
                body = self._body()
            except (ValueError, UnicodeDecodeError) as exc:
                return self._send(400, {"error": "bad request: %s" % exc})

            if self.path == "/run":
                source = body.get("source")
                if not isinstance(source, str):
                    return self._send(400, {"error": "source (the Python text of the script) is required"})
                name = str(body.get("name") or "script.py")[:200]
                timeout = body.get("timeoutSec", DEFAULT_RUN_TIMEOUT)
                if not isinstance(timeout, (int, float)) or timeout < 1 or timeout > MAX_RUN_TIMEOUT:
                    return self._send(400, {"error": "timeoutSec must be between 1 and %s" % MAX_RUN_TIMEOUT})
                data = self._on_fusion(lambda: run_script(source, name), timeout)
                if data is not None:
                    self._send(200, data)
            elif self.path == "/screenshot":
                view = body.get("view", "iso")
                width, height = body.get("width", 1600), body.get("height", 1000)
                if view not in VIEWS or not all(isinstance(v, int) and 16 <= v <= 8000 for v in (width, height)):
                    return self._send(400, {"error": "view must be one of %s and the size 16..8000 px" % ", ".join(VIEWS)})
                data = self._on_fusion(lambda: ops.screenshot(view, width, height), 120)
                if data is not None:
                    self._send(200, data, "image/png")
            elif self.path == "/export":
                fmt = body.get("format")
                if fmt not in EXPORT_FORMATS:
                    return self._send(400, {"error": "format must be one of %s" % ", ".join(EXPORT_FORMATS)})
                data = self._on_fusion(lambda: ops.export(fmt), 120)
                if data is not None:
                    self._send(200, data, "application/octet-stream")
            else:
                self._send(404, {"error": "not found"})

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server


def serve_in_thread(server):
    thread = threading.Thread(target=server.serve_forever, name="PipeFusionHttp", daemon=True)
    thread.start()
    return thread
