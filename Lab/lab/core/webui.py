"""A tiny local JSON API for `lab serve` — the backend half of Lab's web interface. All
presentation lives on bridge's own `/lab` page (React + Gravity UI, the rest of the
ecosystem's own stack); Lab stays exactly what it already is — a standalone Python
project/CLI — and only ever hands over data, the same `history.jsonl` `run`/`measure`/`stats`
already read and write. Lab never renders a page of its own; bridge's frontend calls this API
directly from the browser (CORS-enabled, no auth), with whatever address the person running it
types into that page — see bridge's `pages/LabPage.tsx`.

No authentication, by design and by necessity: this has to be reachable from a phone on the
same Wi-Fi/hotspot as whichever device runs `lab serve`, and bridge's frontend calls it
directly from the browser, not through bridge's own backend (so bridge's backend code stays
entirely unaware that Lab exists — the "low coupling" decision in IMPLEMENTATION_PLAN.md).
Only ever run this on a network you trust, and stop it (Ctrl+C) when the test session is over.

Optional dependency (`pip install -e '.[web]'`) — nothing under `run`/`measure`/`stats`
imports this module or needs Flask installed; `cli.py`'s `serve` command imports it lazily
specifically so those keep working without it.
"""

from __future__ import annotations

import socket
from dataclasses import asdict
from pathlib import Path

from flask import Flask, jsonify, request

from . import stats

# "*" because this is reached from whatever origin bridge's frontend happens to run at
# (localhost in dev, a deployed domain otherwise) and there is no session/cookie to protect
# in the first place — the whole API is unauthenticated by design, see the module docstring.
_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def create_app(project_dir: Path) -> Flask:
    app = Flask(__name__)

    @app.after_request
    def add_cors_headers(response):
        response.headers.update(_CORS_HEADERS)
        return response

    @app.route("/api/<path:_unused>", methods=["OPTIONS"])
    def preflight(_unused):
        return ("", 204)

    @app.get("/")
    def health():
        return jsonify({"status": "ok", "project": project_dir.name})

    @app.get("/api/stats")
    def get_stats():
        summary = {key: asdict(value) for key, value in stats.summarize(project_dir).items()}
        return jsonify({"project": project_dir.name, "summary": summary})

    @app.get("/api/history")
    def get_history():
        limit = request.args.get("limit", default=50, type=int)
        records = [asdict(record) for record in stats.load_history(project_dir)]
        return jsonify({"records": list(reversed(records))[:limit]})

    @app.post("/api/measure")
    def post_measure():
        body = request.get_json(silent=True) or {}
        raw_metrics = body.get("metrics")
        if not isinstance(raw_metrics, dict) or not raw_metrics:
            return jsonify({"error": "metrics должен быть непустым объектом {key: число}"}), 400

        try:
            metrics = stats.coerce_metrics(raw_metrics)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        record = stats.record_measured(project_dir, metrics, str(body.get("note", "")))
        return jsonify(asdict(record)), 201

    return app


def local_network_ip() -> str:
    """The IP a phone on the same network would use to reach this machine — found by asking
    the OS which outbound interface a packet to the public internet would leave from, without
    actually sending one (`SOCK_DGRAM`/`connect` on UDP never puts a packet on the wire).
    Falls back to loopback if that fails (no network at all). A VPN can make this report that
    interface instead of the real LAN one — if a phone can't reach the printed address, check
    the machine's actual Wi-Fi IP by hand.
    """

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def run_server(project_dir: Path, host: str, port: int) -> None:
    create_app(project_dir).run(host=host, port=port, debug=False)
