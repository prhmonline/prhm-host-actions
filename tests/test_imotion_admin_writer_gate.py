import hashlib
import importlib.util
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "ops" / "imotion" / "admin_writer_gate.py"
SPEC = importlib.util.spec_from_file_location("gate", str(SCRIPT))
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)

FIXTURE = (
    "http {\n"
    "    server {\n        listen 443 ssl http2;\n"
    "        server_name other.example;\n"
    "        location / { return 200; }\n    }\n"
    + gate.SERVER_START +
    '        location ^~ /assets/ { try_files $uri =404; }\n'
    + '        location = /nginx-status { return 204; }\n'
    + gate.ROUTE + '            try_files $uri $uri/ /index.php?$query_string;\n        }\n'
    + gate.PHP_ROUTE + '            fastcgi_pass 127.0.0.1:9000;\n        }\n'
    + '    }\n'
    + gate.NEXT_SERVER + '        return 301 https://admin.i-motion.ir$request_uri;\n    }\n}\n'
)


class GateTests(unittest.TestCase):
    def test_only_admin_dynamic_routes_are_modified(self):
        out = gate.render(FIXTURE)
        self.assertEqual(out.count("if (-f " + gate.DEFAULT_FLAG + ")"), 2)
        self.assertIn(gate.ROUTE.splitlines()[1], out)
        self.assertIn('location ^~ /assets/ { try_files $uri =404; }', out)
        self.assertIn('location = /nginx-status { return 204; }', out)
        self.assertEqual(out.split(gate.SERVER_START)[0], FIXTURE.split(gate.SERVER_START)[0])
        self.assertEqual(out.split(gate.NEXT_SERVER)[1], FIXTURE.split(gate.NEXT_SERVER)[1])

    def test_get_post_and_options_reach_dynamic_gate_first(self):
        out = gate.render(FIXTURE)
        segment = out.split(gate.SERVER_START)[1].split(gate.NEXT_SERVER)[0]
        for part in segment.split("            # BEGIN " + gate.MARKER)[1:]:
            self.assertIn("if (-f " + gate.DEFAULT_FLAG + ") { return 503; }", part)
        self.assertLess(segment.find(gate.MARKER), segment.find('if ($request_method = OPTIONS)'))

    def test_double_application_fails_closed(self):
        with self.assertRaises(ValueError):
            gate.render(gate.render(FIXTURE))

    def test_unknown_server_drift_fails_closed(self):
        with self.assertRaises(ValueError):
            gate.render(FIXTURE.replace("admin.i-motion.ir;", "unknown.example;"))

    def test_dynamic_route_drift_fails_closed(self):
        with self.assertRaises(ValueError):
            gate.render(FIXTURE.replace("try_files $uri =404;", "try_files $uri =403;"))

    def test_duplicate_signatures_fail_closed(self):
        with self.assertRaises(ValueError):
            gate.render(FIXTURE + gate.SERVER_START)

    def test_invalid_flags_fail_closed(self):
        for flag in ("relative", "/tmp/../flag", "/tmp//flag", "/tmp/;return_200", "/home/imotion/domains/test"):
            with self.assertRaises(ValueError, msg=flag):
                gate.render(FIXTURE, flag)

    def test_cli_requires_exact_sha_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as d:
            src, dst = (os.path.join(d, name) for name in ("input.conf", "out.conf"))
            with open(src, "w") as f: f.write(FIXTURE)
            sha = hashlib.sha256(FIXTURE.encode()).hexdigest()
            def call(expected):
                return subprocess.run([sys.executable, str(SCRIPT), "--input", src,
                    "--output", dst, "--expected-sha256", expected,
                    "--flag-path", "/tmp/candidate-gate-test"],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self.assertNotEqual(call("0"*64).returncode, 0)
            self.assertFalse(os.path.exists(dst))
            self.assertEqual(call(sha).returncode, 0)
            self.assertNotEqual(call(sha).returncode, 0)
            with open(src) as f: self.assertEqual(f.read(), FIXTURE)


if __name__ == "__main__":
    unittest.main()
