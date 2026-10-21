"""Tests for the parts of the add-in that do not need Fusion: run with `python3 -m unittest discover -s worker/fusion-addin/tests`."""

import http.client
import json
import os
import stat
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "PipeFusion"))

import addin_config  # noqa: E402
import pipe_server  # noqa: E402
from script_runner import MAX_OUTPUT_CHARS, run_script  # noqa: E402

TOKEN = "t" * 40


class ScriptRunnerTest(unittest.TestCase):
    def test_captures_what_a_script_prints_and_calls_run_with_a_json_context(self):
        source = "import json\nprint('top')\ndef run(context):\n    print('ctx', json.loads(context)['isApplicationStartup'])\n    return {'n': 2}\n"
        result = run_script(source, "make.py")

        self.assertTrue(result["ok"])
        self.assertEqual(result["stdout"], "top\nctx False\n")
        self.assertEqual(result["result"], {"n": 2})
        self.assertIsNone(result["error"])

    def test_reports_an_exception_with_its_traceback_instead_of_raising(self):
        result = run_script("def run(context):\n    raise RuntimeError('no sketch')\n", "bad.py")

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "RuntimeError: no sketch")
        self.assertIn("bad.py", result["traceback"])

    def test_a_syntax_error_is_a_failed_script_not_a_crash(self):
        result = run_script("def run(:\n", "oops.py")

        self.assertFalse(result["ok"])
        self.assertTrue(result["error"].startswith("SyntaxError"))

    def test_sys_exit_does_not_take_the_thread_down(self):
        result = run_script("import sys\nsys.exit(3)\n")

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "SystemExit: 3")

    def test_a_result_that_is_not_json_is_returned_as_text(self):
        result = run_script("def run(context):\n    return object()\n")

        self.assertTrue(result["ok"])
        self.assertTrue(result["result"].startswith("<object"))

    def test_runs_a_script_without_run_and_keeps_stderr_apart(self):
        result = run_script("import sys\nprint('out')\nprint('err', file=sys.stderr)\n")

        self.assertEqual((result["stdout"], result["stderr"]), ("out\n", "err\n"))

    def test_cuts_a_huge_output(self):
        result = run_script("print('x' * %d)\n" % (MAX_OUTPUT_CHARS * 2))

        self.assertLess(len(result["stdout"]), MAX_OUTPUT_CHARS + 100)
        self.assertIn("[output cut]", result["stdout"])

    def test_scripts_do_not_share_names(self):
        run_script("leak = 1\n")

        self.assertIn("NameError", run_script("print(leak)\n")["error"])


class ConfigTest(unittest.TestCase):
    def test_path_follows_the_environment_variable_or_the_home_directory(self):
        self.assertEqual(addin_config.config_path({"PIPE_FUSION_CONFIG": " /tmp/x.json "}), "/tmp/x.json")
        self.assertEqual(addin_config.config_path({}, "/Users/me"), "/Users/me/.pipe-fusion/config.json")

    def test_writes_the_port_and_token_readable_by_the_owner_only_and_reuses_the_token(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "sub", "config.json")
            token = addin_config.load_token(path)

            self.assertGreaterEqual(len(token), 32)
            addin_config.write_config(path, 47615, token)

            with open(path, encoding="utf-8") as handle:
                self.assertEqual(json.load(handle), {"port": 47615, "token": token})
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
            self.assertEqual(addin_config.load_token(path), token)

            addin_config.remove_config(path)
            self.assertFalse(os.path.exists(path))
            addin_config.remove_config(path)  # already gone: fine

    def test_a_damaged_file_gets_a_new_token(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "config.json")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write("not json")

            self.assertGreaterEqual(len(addin_config.load_token(path)), 32)


class FakeDispatcher:
    def __init__(self):
        self.timeout = None

    def call(self, fn, timeout):
        if self.timeout is not None:
            raise pipe_server.DispatchTimeout()
        return fn()


class FakeOps:
    def __init__(self):
        self.calls = []
        self.fail = None

    def _do(self, name, value, *args):
        self.calls.append((name,) + args)
        if self.fail:
            raise RuntimeError(self.fail)
        return value

    def health(self):
        return self._do("health", {"app": "Fusion", "version": "2.0", "document": "boat"})

    def info(self):
        return self._do("info", {"bodies": []})

    def screenshot(self, view, width, height):
        return self._do("screenshot", b"\x89PNG", view, width, height)

    def export(self, fmt):
        return self._do("export", b"STEPDATA", fmt)


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.dispatcher = FakeDispatcher()
        self.ops = FakeOps()
        self.server = pipe_server.make_server(0, TOKEN, self.dispatcher, self.ops)
        pipe_server.serve_in_thread(self.server)
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def request(self, method, path, body=None, headers=None, token=TOKEN):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        sent = {"Authorization": "Bearer " + token} if token else {}
        sent.update(headers or {})
        payload = None
        if body is not None:
            payload = json.dumps(body)
            sent["Content-Type"] = "application/json"
        connection.request(method, path, body=payload, headers=sent)
        response = connection.getresponse()
        data = response.read()
        connection.close()
        return response.status, response.getheader("Content-Type"), data

    def test_listens_on_localhost_only(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")

    def test_refuses_a_missing_or_wrong_token_a_browser_origin_and_a_foreign_host(self):
        self.assertEqual(self.request("GET", "/health", token=None)[0], 401)
        self.assertEqual(self.request("GET", "/health", token="x" * 40)[0], 401)
        self.assertEqual(self.request("GET", "/health", headers={"Origin": "http://evil.example"})[0], 401)
        self.assertEqual(self.request("GET", "/health", headers={"Host": "evil.example"})[0], 401)
        self.assertEqual(self.ops.calls, [])

    def test_health_and_info_come_from_fusion(self):
        status, _, data = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data), {"app": "Fusion", "version": "2.0", "document": "boat", "ok": True})
        self.assertEqual(json.loads(self.request("GET", "/info")[2]), {"bodies": []})
        self.assertEqual(self.request("GET", "/nope")[0], 404)

    def test_runs_a_script_through_the_dispatcher(self):
        status, _, data = self.request("POST", "/run", {"source": "print(1+1)", "name": "a.py", "timeoutSec": 30})

        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)["stdout"], "2\n")

    def test_rejects_a_bad_run_request(self):
        self.assertEqual(self.request("POST", "/run", {})[0], 400)
        self.assertEqual(self.request("POST", "/run", {"source": "x", "timeoutSec": 0})[0], 400)
        self.assertEqual(self.request("POST", "/run", {"source": "x", "timeoutSec": 99999})[0], 400)

    def test_a_script_that_takes_too_long_is_a_504_not_a_hang(self):
        self.dispatcher.timeout = True

        status, _, data = self.request("POST", "/run", {"source": "x"})

        self.assertEqual(status, 504)
        self.assertIn("did not finish", json.loads(data)["error"])

    def test_screenshot_returns_the_image_bytes_for_a_valid_view(self):
        status, content_type, data = self.request("POST", "/screenshot", {"view": "top", "width": 800, "height": 600})

        self.assertEqual((status, content_type, data), (200, "image/png", b"\x89PNG"))
        self.assertIn(("screenshot", "top", 800, 600), self.ops.calls)
        self.assertEqual(self.request("POST", "/screenshot", {"view": "up"})[0], 400)
        self.assertEqual(self.request("POST", "/screenshot", {"width": 5})[0], 400)

    def test_export_returns_the_file_for_a_known_format_only(self):
        status, content_type, data = self.request("POST", "/export", {"format": "step"})

        self.assertEqual((status, content_type, data), (200, "application/octet-stream", b"STEPDATA"))
        self.assertEqual(self.request("POST", "/export", {"format": "dwg"})[0], 400)

    def test_an_error_inside_fusion_is_a_500_with_the_reason(self):
        self.ops.fail = "The active document is not a Fusion design"

        status, _, data = self.request("POST", "/export", {"format": "f3d"})

        self.assertEqual(status, 500)
        self.assertIn("not a Fusion design", json.loads(data)["error"])

    def test_a_body_that_is_not_json_is_a_400(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        connection.request("POST", "/run", body="{nope", headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"})

        self.assertEqual(connection.getresponse().status, 400)
        connection.close()


if __name__ == "__main__":
    unittest.main()
