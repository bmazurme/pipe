"""A tiny local web form for `lab serve` — recording test observations from a phone or
tablet while physically testing something (on the water, at the field), where pulling out a
laptop and typing a `lab measure key=value` command isn't practical. Reuses
`stats.parse_assignments`/`stats.record_measured` exactly as the CLI does — this is a second
front door onto the same `history.jsonl`, not a parallel storage mechanism.

No authentication, by design and by necessity for this use case: `lab serve` defaults to
binding every network interface (`0.0.0.0`), because the whole point is that a phone on the
same Wi-Fi/hotspot can reach it — anyone else on that network could too. Only ever run this on
a network you trust (your own hotspot, home Wi-Fi), never on anything public, and stop it
(Ctrl+C) when the test session is over rather than leaving it running.

Optional dependency (`pip install -e '.[web]'`) — nothing under `run`/`measure`/`stats`
imports this module or needs Flask installed; `cli.py`'s `serve` command imports it lazily
specifically so those keep working without it.
"""

from __future__ import annotations

import socket
from pathlib import Path

from flask import Flask, redirect, render_template_string, request, url_for

from . import stats

PAGE_TEMPLATE = """
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lab — {{ project_name }}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 640px; margin: 0 auto;
           padding: 16px; line-height: 1.4; }
    h1 { font-size: 1.15rem; }
    textarea, input[type=text] { width: 100%; box-sizing: border-box; font-size: 1rem; padding: 10px;
           margin-bottom: 10px; border: 1px solid #8888; border-radius: 6px; background: transparent;
           color: inherit; }
    textarea { font-family: ui-monospace, monospace; }
    button { font-size: 1.1rem; padding: 12px 20px; width: 100%; border-radius: 6px; border: none;
           background: #2563eb; color: white; }
    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; margin-top: 18px; }
    th, td { text-align: left; border-bottom: 1px solid #8884; padding: 5px 6px; }
    .flash { padding: 10px 12px; border-radius: 6px; margin-bottom: 14px; }
    .flash-ok { background: rgba(26, 127, 55, 0.12); border: 1px solid #1a7f37; }
    .flash-error { background: rgba(207, 34, 46, 0.12); border: 1px solid #cf222e; }
    .hint { color: #888; font-size: 0.82rem; margin: -6px 0 12px; }
  </style>
</head>
<body>
  <h1>{{ project_name }}</h1>
  {% if flash %}<div class="flash flash-{{ flash_kind }}">{{ flash }}</div>{% endif %}

  <form method="post" action="{{ url_for('measure_submit') }}">
    <input type="text" name="note" placeholder="Заметка — заезд 3, озеро, ветер слабый">
    <textarea name="assignments" rows="5" placeholder="total_mass_kg=0.95
hydrostatics.waterline_transom_mm=24"></textarea>
    <p class="hint">По одной метрике на строку: ключ=значение.</p>
    <button type="submit">Записать</button>
  </form>

  <table>
    <tr><th>Метрика</th><th>Расчёт</th><th>Факт</th><th>Разница</th></tr>
    {% for key, row in summary.items() %}
    <tr>
      <td>{{ key }}</td>
      <td>{{ '%.4g' % row.latest_predicted if row.latest_predicted is not none else '—' }}</td>
      <td>{{ '%.4g' % row.latest_measured if row.latest_measured is not none else '—' }}</td>
      <td>{{ '%+.1f%%' % row.diff_pct if row.diff_pct is not none else '—' }}</td>
    </tr>
    {% endfor %}
  </table>
  {% if not summary %}<p class="hint">История пуста — сначала `lab run`, затем сюда можно записывать замеры.</p>{% endif %}
</body>
</html>
"""


def create_app(project_dir: Path) -> Flask:
    app = Flask(__name__)

    @app.get("/")
    def index():
        summary = stats.summarize(project_dir)
        return render_template_string(
            PAGE_TEMPLATE,
            project_name=project_dir.name,
            summary=dict(sorted(summary.items())),
            flash=request.args.get("flash"),
            flash_kind=request.args.get("flash_kind", "ok"),
        )

    @app.post("/measure")
    def measure_submit():
        note = request.form.get("note", "")
        try:
            metrics = stats.parse_assignments(request.form.get("assignments", "").splitlines())
            if not metrics:
                raise ValueError("Не введено ни одной метрики")
            stats.record_measured(project_dir, metrics, note)
        except ValueError as exc:
            return redirect(url_for("index", flash=str(exc), flash_kind="error"))

        return redirect(url_for("index", flash=f"Записано: {', '.join(metrics)}", flash_kind="ok"))

    return app


def local_network_ip() -> str:
    """The IP a phone on the same network would use to reach this machine — found by asking
    the OS which outbound interface a packet to the public internet would leave from, without
    actually sending one (`SOCK_DGRAM`/`connect` on UDP never puts a packet on the wire).
    Falls back to loopback if that fails (no network at all) — `lab serve` still works for
    `localhost`, just not from a second device.
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
