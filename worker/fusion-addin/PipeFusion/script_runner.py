"""Runs a Fusion script given as source text — the part of the add-in that does not need Fusion itself.

A Fusion script defines ``run(context)`` and Fusion calls it. Here the source is executed in a fresh namespace and, when it defines
``run``, that function is called the same way. What the script prints and what it raises come back as data.
"""

import contextlib
import io
import json
import traceback

MAX_OUTPUT_CHARS = 200_000
# Fusion passes the context to run() as a JSON string.
SCRIPT_CONTEXT = json.dumps({"isApplicationStartup": False})


def _clip(text):
    if len(text) <= MAX_OUTPUT_CHARS:
        return text
    return text[:MAX_OUTPUT_CHARS] + "\n...[output cut]\n"


def _jsonable(value):
    """The value if it survives JSON, else its repr — a script may return anything."""
    if value is None:
        return None
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return repr(value)


def run_script(source, name="script.py"):
    stdout = io.StringIO()
    stderr = io.StringIO()
    namespace = {"__name__": "__pipe_script__", "__file__": name}
    result = None
    error = None
    trace = None
    ok = True

    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        try:
            exec(compile(source, name, "exec"), namespace)
            entry = namespace.get("run")
            if callable(entry):
                result = entry(SCRIPT_CONTEXT)
        except BaseException as exc:  # a script may even call sys.exit(); it must not take Fusion's thread down
            ok = False
            error = "%s: %s" % (type(exc).__name__, exc)
            trace = traceback.format_exc()

    return {
        "ok": ok,
        "stdout": _clip(stdout.getvalue()),
        "stderr": _clip(stderr.getvalue()),
        "error": error,
        "traceback": _clip(trace) if trace else None,
        "result": _jsonable(result),
    }
