"""Tests for probe.py: the classification, real local sockets for each way a connection can end, and the whole run against a fake bridge.
    python3 -m unittest discover -s infra/linkprobe
"""
import http.server
import json
import os
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import unittest
from unittest import mock

import probe


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Listener:
    """A TCP listener on localhost whose accepted connections are handled by `handler(conn)` in a thread."""

    def __init__(self, handler):
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(8)
        self.port = self.sock.getsockname()[1]
        self.conns = []
        self.handler = handler
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def _loop(self):
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            self.conns.append(conn)
            threading.Thread(target=self.handler, args=(conn,), daemon=True).start()

    def close(self):
        for c in self.conns:
            try:
                c.close()
            except OSError:
                pass
        self.sock.close()


class Classify(unittest.TestCase):
    def test_tcp_stage(self):
        self.assertEqual(probe.classify("tcp", socket.timeout(), True)[0], "tcp_timeout")
        self.assertEqual(probe.classify("tcp", ConnectionRefusedError(111, "x"), False), ("tcp_refused", "ConnectionRefusedError:111"))  # errno given explicitly
        self.assertEqual(probe.classify("tcp", OSError(101, "unreachable"), False)[0], "error")

    def test_tls_stage(self):
        self.assertEqual(probe.classify("tls", socket.timeout(), True)[0], "tls_timeout")
        self.assertEqual(probe.classify("tls", ConnectionResetError(104, "reset"), False)[0], "tls_reset")
        self.assertEqual(probe.classify("tls", BrokenPipeError(32, "pipe"), False)[0], "tls_reset")
        self.assertEqual(probe.classify("tls", ssl.SSLError("bad"), False)[0], "tls_error")
        self.assertEqual(probe.classify("tls", EOFError(), False)[0], "tls_error")


class RealSockets(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        cls.cert = os.path.join(cls.dir, "c.pem")
        cls.key = os.path.join(cls.dir, "k.pem")
        cls.have_openssl = shutil.which("openssl") is not None
        if cls.have_openssl:
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", cls.key, "-out", cls.cert, "-days", "1", "-subj", "/CN=example.com"],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir, ignore_errors=True)

    def test_refused_port(self):
        outcome = probe.probe("127.0.0.1", free_port(), "example.com", 2)

        self.assertEqual(outcome["result"], "tcp_refused")
        self.assertIsNone(outcome["tcpMs"])

    def test_a_server_that_accepts_and_says_nothing(self):
        server = Listener(lambda conn: threading.Event().wait(3))
        try:
            outcome = probe.probe("127.0.0.1", server.port, "example.com", 0.4)
        finally:
            server.close()

        self.assertEqual(outcome["result"], "tls_timeout")
        self.assertIsNotNone(outcome["tcpMs"])
        self.assertIsNone(outcome["tlsMs"])

    def test_a_peer_that_is_not_tls(self):
        def handler(conn):
            conn.sendall(b"HTTP/1.1 400 Bad Request\r\n\r\n")
            conn.close()

        server = Listener(handler)
        try:
            outcome = probe.probe("127.0.0.1", server.port, "example.com", 2)
        finally:
            server.close()

        self.assertIn(outcome["result"], ("tls_error", "tls_reset"))
        self.assertIsNotNone(outcome["tcpMs"])

    def test_a_real_tls_handshake_is_ok_with_both_times_and_the_sni_it_was_given(self):
        if not self.have_openssl:
            self.skipTest("openssl is not installed")
        seen = []
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(self.cert, self.key)
        context.set_servername_callback(lambda sock, name, ctx: seen.append(name))

        def handler(conn):
            try:
                context.wrap_socket(conn, server_side=True).close()
            except (ssl.SSLError, OSError):
                pass

        server = Listener(handler)
        try:
            outcome = probe.probe("127.0.0.1", server.port, "www.samsung.com", 3)
        finally:
            server.close()

        self.assertEqual(outcome["result"], "ok")
        self.assertIsNotNone(outcome["tcpMs"])
        self.assertIsNotNone(outcome["tlsMs"])
        self.assertIsNone(outcome["detail"])
        self.assertEqual(seen, ["www.samsung.com"])


class FakeBridge:
    def __init__(self, channels, status=200):
        outer = self
        self.posts = []
        self.gets = 0
        self.auth = set()
        self.channels = channels

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                outer.gets += 1
                outer.auth.add(self.headers.get("Authorization"))
                body = json.dumps(outer.channels).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                length = int(self.headers.get("Content-Length", 0))
                outer.posts.append((self.path, json.loads(self.rfile.read(length))))
                outer.auth.add(self.headers.get("Authorization"))
                self.send_response(204)
                self.end_headers()

        self.server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:%d" % self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class WholeRun(unittest.TestCase):
    def run_main(self, **env):
        base = {"BRIDGE_API_KEY": "brk_secret", "VANTAGE": "test-place", "PROBE_TIMEOUT": "1"}
        base.update(env)
        with mock.patch.dict(os.environ, base, clear=False):
            return probe.main()

    def test_it_fetches_the_channels_probes_them_and_reports_under_its_name(self):
        dead = free_port()
        bridge = FakeBridge([
            {"key": "127.0.0.1:%d" % dead, "name": "dead", "host": "127.0.0.1", "port": dead, "sni": "example.com"},
            {"key": "bad", "name": "no host"},
            "junk",
        ])
        try:
            self.assertEqual(self.run_main(BRIDGE_API_URL=bridge.url), 0)
        finally:
            bridge.close()

        self.assertEqual(bridge.gets, 1)
        self.assertEqual(len(bridge.posts), 1)
        path, body = bridge.posts[0]
        self.assertEqual(path, "/api/v1/boards/agent/links")
        self.assertEqual(body["vantage"], "test-place")
        self.assertEqual(len(body["results"]), 1)
        # the errno in the detail differs between systems (61 on macOS, 111 on Linux)
        self.assertEqual({k: v for k, v in body["results"][0].items() if k != "detail"}, {"key": "127.0.0.1:%d" % dead, "result": "tcp_refused"})
        self.assertTrue(body["results"][0]["detail"].startswith("ConnectionRefusedError"))
        self.assertEqual(bridge.auth, {"Bearer brk_secret"})

    def test_it_tries_the_next_bridge_address_when_the_first_does_not_answer(self):
        bridge = FakeBridge([])
        try:
            self.run_main(BRIDGE_API_URL="http://127.0.0.1:%d, %s" % (free_port(), bridge.url))
        finally:
            bridge.close()

        self.assertEqual(bridge.gets, 1)
        self.assertEqual(len(bridge.posts), 1)

    def test_it_reports_to_the_address_that_gave_it_the_channels(self):
        first, second = FakeBridge([]), FakeBridge([])
        try:
            self.run_main(BRIDGE_API_URL="%s %s" % (first.url, second.url))
        finally:
            first.close()
            second.close()

        self.assertEqual((len(first.posts), len(second.posts)), (1, 0))

    def test_without_a_key_it_does_nothing(self):
        bridge = FakeBridge([])
        try:
            self.assertEqual(self.run_main(BRIDGE_API_URL=bridge.url, BRIDGE_API_KEY=""), 0)
        finally:
            bridge.close()

        self.assertEqual((bridge.gets, len(bridge.posts)), (0, 0))

    def test_an_unreachable_bridge_is_not_an_error(self):
        self.assertEqual(self.run_main(BRIDGE_API_URL="http://127.0.0.1:%d" % free_port()), 0)

    def test_a_bridge_that_refuses_the_key_is_not_an_error_and_nothing_is_probed(self):
        bridge = FakeBridge([], status=403)
        try:
            self.assertEqual(self.run_main(BRIDGE_API_URL=bridge.url), 0)
        finally:
            bridge.close()

        self.assertEqual(len(bridge.posts), 0)

    def test_addresses_ignores_anything_that_is_not_an_http_address(self):
        self.assertEqual(probe.addresses("https://a.example, ftp://x  http://b.example junk"), ["https://a.example", "http://b.example"])


if __name__ == "__main__":
    unittest.main()
