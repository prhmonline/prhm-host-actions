#!/usr/bin/env python3
"""Synthetic-only tests for owner device off-node escrow CLI; no business keys."""
import importlib.util
import io
import json
import os
import pathlib
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock

HERE = pathlib.Path(__file__).resolve().parent
SCRIPT = HERE / "node1-offsite-owner-key-v1.py"
spec = importlib.util.spec_from_file_location("prhm_owner_escrow", str(SCRIPT))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class OwnerOfflineEscrow(unittest.TestCase):
    def test_real_cli_help_and_blocked_host(self):
        import subprocess
        import sys
        with tempfile.TemporaryDirectory() as t:
            p = subprocess.run([sys.executable, str(SCRIPT), "--help"],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               timeout=10)
            self.assertEqual(p.returncode, 0, p.stderr.decode(errors="replace"))
            self.assertIn(b"attest", p.stdout)
            # No production-central key should be created even if invoked by mistake.
            unsafe = pathlib.Path(t) / "refuse"
            blocked = subprocess.run([sys.executable, str(SCRIPT), "create",
                                      "--directory", str(unsafe)],
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     timeout=10)
            # This runner itself is executed on PRHM's central guest.
            if "prhm-production" in mod.socket.getfqdn().lower():
                self.assertEqual(blocked.returncode, 3)
                self.assertFalse(unsafe.exists())

    def test_refuse_on_prod_or_node1(self):
        for host in ["prhm-production.prhm.ir", "server1.prhm.ir", "node1"]:
            with self.assertRaisesRegex(ValueError, "REFUSE_ON_NODE1_OR_PRODUCTION_HOST"):
                mod.assert_off_server(host)
        self.assertEqual(mod.assert_off_server("owners-laptop"), "owners-laptop")

    def test_create_requires_new_folder(self):
        with tempfile.TemporaryDirectory() as t, mock.patch.object(mod, "assert_off_server", return_value="owners-laptop"):
            destination = pathlib.Path(t) / "private"
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                mod.init_key(destination)
            secret = (destination / mod.KEY_FILE).read_bytes()
            self.assertGreaterEqual(len(secret), 48)
            self.assertNotIn(secret.decode(), stdout.getvalue())
            receipt = json.loads((destination / mod.RECEIPT_FILE).read_text())
            self.assertFalse(receipt["independent_physical_copy_confirmed"])
            self.assertEqual(receipt["verification"], "NOT_TESTED")
            self.assertEqual(receipt["key_sha256"], mod.hashlib.sha256(secret).hexdigest())
            if os.name == "posix":
                self.assertEqual(destination.stat().st_mode & 0o777, 0o700)
                self.assertEqual((destination / mod.KEY_FILE).stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                mod.init_key(destination)

    @unittest.skipUnless(shutil.which("gpg"), "gpg required for AES recovery drill")
    def test_recover_from_separate_file_and_decrypt_ciphertext(self):
        with tempfile.TemporaryDirectory() as t, mock.patch.object(mod, "assert_off_server", return_value="owners-laptop"):
            root = pathlib.Path(t)
            private = root / "private"
            with redirect_stdout(io.StringIO()):
                mod.init_key(private)
            secret = (private / mod.KEY_FILE).read_bytes()
            recovered = root / "recovered-from-password-manager.txt"
            mod.private_file_create(recovered, secret)
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                mod.attest_key(private, recovered)
            receipt = json.loads((private / mod.RECEIPT_FILE).read_text())
            self.assertTrue(receipt["independent_physical_copy_confirmed"])
            self.assertEqual(receipt["verification"], "OWNER_ATTESTED_DISTINCT_RECOVERY_AND_GPG_DECRYPTION")
            self.assertIn("OFF_SERVER_RECOVERED_KEY_GPG_TEST=PASS", stdout.getvalue())
            self.assertNotIn(secret.decode(), stdout.getvalue())
            with self.assertRaisesRegex(ValueError, "OWNER_RECEIPT_ALREADY_CONFIRMED"):
                mod.attest_key(private, recovered)

    def test_wrong_or_same_path_rejected_and_no_false_receipt(self):
        with tempfile.TemporaryDirectory() as t, mock.patch.object(mod, "assert_off_server", return_value="owners-laptop"):
            root = pathlib.Path(t)
            private = root / "private"
            with redirect_stdout(io.StringIO()):
                mod.init_key(private)
            with self.assertRaisesRegex(ValueError, "RECOVERED_KEY_MUST_BE_SEPARATE_FILE"):
                mod.attest_key(private, private / mod.KEY_FILE)
            bad = root / "wrong_key"
            mod.private_file_create(bad, b"0"*96)
            with self.assertRaisesRegex(ValueError, "OFF_DEVICE_RECOVERY_KEY_MISMATCH"):
                mod.attest_key(private, bad)
            self.assertFalse(json.loads((private / mod.RECEIPT_FILE).read_text())["independent_physical_copy_confirmed"])

    def test_no_secret_output_in_source_or_remote_link(self):
        source = SCRIPT.read_text()
        self.assertIn("REFUSE_ON_NODE1_OR_PRODUCTION_HOST", source)
        self.assertIn("OFF_SERVER_RECOVERED_KEY_GPG_TEST=PASS", source)
        self.assertIn("if decoder.returncode or not hmac.compare_digest(decoder.stdout, challenge)", source)
        self.assertIn('if not hmac.compare_digest(original_secret, recovered_secret)', source)
        self.assertIn('"confirmed_by": "owner"', source)
        self.assertIn('"independent_physical_copy_confirmed": False', source)
        self.assertNotIn("requests.post", source)
        self.assertNotIn("smtplib", source)


if __name__ == "__main__":
    unittest.main()
