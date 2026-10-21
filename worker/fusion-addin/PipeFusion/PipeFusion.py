"""pipe add-in for Autodesk Fusion 360.

Starts a small HTTP server on 127.0.0.1 so that a pipe worker on this Mac can run Python scripts inside Fusion, look at the model
(a screenshot) and export it. See worker/fusion-addin/README.md.

Fusion's API may only be used on its main thread: the server answers on its own threads and hands the work over through a custom
event, which Fusion delivers on the main thread.
"""

import os
import queue
import sys
import threading
import traceback

import adsk.core

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import addin_config  # noqa: E402
import fusion_ops  # noqa: E402
from pipe_server import DEFAULT_PORT_FALLBACKS, DispatchTimeout, make_server, serve_in_thread  # noqa: E402

CUSTOM_EVENT_ID = "PipeFusionDispatch"

_handlers = []
_state = {"server": None, "config_path": None, "event": None}
_work = queue.Queue()


class _Job:
    def __init__(self, fn):
        self.fn = fn
        self.done = threading.Event()
        self.value = None
        self.error = None


class _EventHandler(adsk.core.CustomEventHandler):
    def notify(self, args):
        try:
            job = _work.get_nowait()
        except queue.Empty:
            return
        try:
            job.value = job.fn()
        except BaseException as exc:
            job.error = exc
        finally:
            job.done.set()


class _Dispatcher:
    """Runs a function on Fusion's main thread and waits for its result."""

    def call(self, fn, timeout):
        job = _Job(fn)
        _work.put(job)
        adsk.core.Application.get().fireCustomEvent(CUSTOM_EVENT_ID, "")
        if not job.done.wait(timeout):
            raise DispatchTimeout()
        if job.error is not None:
            raise job.error
        return job.value


def run(context):
    app = adsk.core.Application.get()
    ui = app.userInterface
    try:
        event = app.registerCustomEvent(CUSTOM_EVENT_ID)
        handler = _EventHandler()
        event.add(handler)
        _handlers.append(handler)
        _state["event"] = event

        path = addin_config.config_path()
        token = addin_config.load_token(path)
        server = None
        for port in DEFAULT_PORT_FALLBACKS:
            try:
                server = make_server(port, token, _Dispatcher(), fusion_ops)
                break
            except OSError:
                continue
        if server is None:
            raise RuntimeError("no free local port for the pipe add-in")

        serve_in_thread(server)
        addin_config.write_config(path, server.server_address[1], token)
        _state["server"] = server
        _state["config_path"] = path
    except BaseException:
        if ui:
            ui.messageBox("pipe add-in failed to start:\n{}".format(traceback.format_exc()))


def stop(context):
    app = adsk.core.Application.get()
    server = _state.get("server")
    if server is not None:
        server.shutdown()
        server.server_close()
        _state["server"] = None
    if _state.get("config_path"):
        addin_config.remove_config(_state["config_path"])
    try:
        app.unregisterCustomEvent(CUSTOM_EVENT_ID)
    except BaseException:
        pass
    del _handlers[:]
