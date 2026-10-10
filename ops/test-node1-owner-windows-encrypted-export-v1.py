#!/usr/bin/env python3
"""No customer data tests for owner's no-billing encrypted SSH export."""
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

HERE = pathlib.Path(__file__).resolve().parent
PATH = HERE / "node1-owner-windows-encrypted-export-v1.py"
spec = importlib.util.spec_from_file_location("owner_export", str(PATH))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def fake_snapshot(root):
    src = root / m.SNAPSHOT
    (src / "db").mkdir(parents=True)
    (src / "files").mkdir()
    items = {
        "COMPLETE": b"",
        "MANIFEST": b"synthetic manifest",
        "db/database_names.txt": b"\n".join(("db%d" % k).encode() for k in range(6)),
        "db/all-databases.sql.gz": os.urandom(8192),
        "files/node1-hostdata.tar.zst": os.urandom(32768),
        "files/coverage-proof.json": json.dumps(
            {"ok": True, "ratio": 1.0, "site_regular_files": 109828}
        ).encode()
    }
    for name, payload in items.items():
        (src / name).write_bytes(payload)
    checks = "".join(hashlib.sha256(v).hexdigest() + "  " + k + "\n"
                     for k, v in items.items())
    (src / "SHA256SUMS").write_text(checks)
    tar_path = root / "sample.tar"
    with tarfile.open(str(tar_path), "w") as archive:
        archive.add(str(src), arcname=m.SNAPSHOT)
    return tar_path


def fake_cipher(root, tar_path, secret):
    executable = shutil.which("gpg")
    if not executable:
        raise unittest.SkipTest("gpg unavailable")
    crypt = root / "sample.tar.gpg"
    p = subprocess.run([executable, "--batch", "--no-tty", "--pinentry-mode",
                        "loopback", "--passphrase-file", str(secret),
                        "--symmetric", "--cipher-algo", "AES256",
                        "--compress-algo", "none", "--s2k-digest-algo", "SHA256",
                        "--output", str(crypt), str(tar_path)],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    assert p.returncode == 0, p.stderr
    return crypt


class OfflineOwnerExport(unittest.TestCase):
    def test_no_cloud_api_or_server_write_commands(self):
        source = PATH.read_text()
        self.assertIn("StrictHostKeyChecking=yes", source)
        self.assertIn("IdentitiesOnly=yes", source)
        self.assertIn("tar -C ", source)
        self.assertIn("sha256sum -c SHA256SUMS", source)
        self.assertIn("--symmetric --cipher-algo AES256", source)
        self.assertNotIn("rclone", source.lower())
        self.assertNotIn("https://", source)
        self.assertNotIn("curl ", source)
        self.assertNotIn("wget ", source)
        self.assertNotIn("googleapis", source.lower())
        self.assertIn("-J", source)
        self.assertIn("40222", source)
        self.assertIn("SNAPSHOT +", source)

    def test_account_previously_approved_ssh_key_fingerprint(self):
        self.assertEqual(m.WINDOWS_PUBLIC_KEY_FINGERPRINT,
                         "SHA256:WEd6aCEVqn+FE6Yx8sTWBUfmsbKwNxz70M+x+HZsr0Q")
        cmd = m.remote_command()
        self.assertIn("bash -o pipefail -c", cmd)
        self.assertIn("node1-hostdata-gpg.passphrase", cmd)
        self.assertNotIn("scp ", cmd)

    def test_owner_windows_only(self):
        with mock.patch.object(m.platform, "system", return_value="Linux"):
            with self.assertRaisesRegex(RuntimeError, "OWNER_WINDOWS_DEVICE_REQUIRED"):
                m.assert_owner_windows()
        with mock.patch.object(m.platform, "system", return_value="Windows"), \
             mock.patch.object(m.socket, "getfqdn", return_value="node1.test"):
            with self.assertRaisesRegex(RuntimeError, "OWNER_WINDOWS_DEVICE_REQUIRED"):
                m.assert_owner_windows()
        with mock.patch.object(m.platform, "system", return_value="Windows"), \
             mock.patch.object(m.socket, "getfqdn", return_value="owners-laptop"):
            m.assert_owner_windows()

    def test_owner_escrow_fingerprint_and_no_secret_print(self):
        with tempfile.TemporaryDirectory() as t:
            base = pathlib.Path(t)
            secret = os.urandom(48).hex().encode("ascii")
            (base / m.KEY_FILENAME).write_bytes(secret)
            receipt = {"schema": "prhm.offsite-key-escrow.v1",
                       "confirmed_by": "owner",
                       "independent_physical_copy_confirmed": True,
                       "verification": "OWNER_ATTESTED_DISTINCT_RECOVERY_AND_GPG_DECRYPTION",
                       "key_sha256": hashlib.sha256(secret).hexdigest()}
            (base / m.RECEIPT_FILENAME).write_text(json.dumps(receipt))
            self.assertEqual(m.check_receipt(base), base / m.KEY_FILENAME)
            receipt["independent_physical_copy_confirmed"] = False
            (base / m.RECEIPT_FILENAME).write_text(json.dumps(receipt))
            with self.assertRaisesRegex(RuntimeError, "OWNER_KEY_RECOVERY_NOT_VERIFIED"):
                m.check_receipt(base)

    @unittest.skipUnless(shutil.which("gpg"), "gpg needed")
    def test_synthetic_encrypted_tar_decrypt_and_sha256sum_restore(self):
        with tempfile.TemporaryDirectory() as t:
            root = pathlib.Path(t)
            key = root / "key"
            key.write_bytes(os.urandom(48).hex().encode())
            crypt = fake_cipher(root, fake_snapshot(root), key)
            result = m.verify_archive(crypt, key, m.sha_file(crypt))
            self.assertEqual(result["database_count"], 6)
            self.assertEqual(result["site_regular_files"], 109828)
            self.assertEqual(result["files_checked"], 6)
            with self.assertRaisesRegex(RuntimeError, "ENCRYPTED_CLOUD_BYTES_MISMATCH"):
                m.verify_archive(crypt, key, "0"*64)

    @unittest.skipUnless(shutil.which("gpg"), "gpg needed")
    def test_wrong_decrypt_key_fails_closed(self):
        with tempfile.TemporaryDirectory() as t:
            root = pathlib.Path(t)
            key = root / "key"
            key.write_bytes(os.urandom(48).hex().encode())
            wrong = root / "wrong"
            wrong.write_bytes(os.urandom(48).hex().encode())
            crypt = fake_cipher(root, fake_snapshot(root), key)
            with self.assertRaises((RuntimeError, tarfile.TarError, EOFError)):
                m.verify_archive(crypt, wrong)

    def test_existing_archive_never_overwritten_and_ssh_used_only_when_eligible(self):
        with tempfile.TemporaryDirectory() as t:
            root = pathlib.Path(t)
            out = root / "output"
            out.mkdir()
            (out / (m.SNAPSHOT + ".snapshot.tar.gpg")).write_bytes(b"do not touch")
            with mock.patch.object(m, "assert_owner_windows"), \
                 mock.patch.object(m, "owner_paths", return_value=(root, out)), \
                 mock.patch.object(m, "check_receipt", return_value=root / "fake.key"), \
                 mock.patch.object(m, "find_authorized_key", return_value=root / "fake.ssh"), \
                 mock.patch.object(m, "gpg_executable", return_value="/usr/bin/gpg"):
                with self.assertRaisesRegex(RuntimeError, "ARCHIVE_ALREADY_EXISTS_NEVER_OVERWRITE"):
                    m.fetch()
            self.assertEqual((out / (m.SNAPSHOT + ".snapshot.tar.gpg")).read_bytes(), b"do not touch")

    def test_diagnose_is_read_only_and_reports_checkpoint(self):
        with tempfile.TemporaryDirectory() as t:
            root = pathlib.Path(t)
            output = root / "out"
            target = mock.Mock(returncode=0, stdout=b"READ_ONLY_SSH_PREFLIGHT_OK\n")
            with mock.patch.object(m, "assert_owner_windows"), \
                 mock.patch.object(m, "owner_paths", return_value=(root, output)), \
                 mock.patch.object(m, "check_receipt", return_value=root / "fake.key"), \
                 mock.patch.object(m, "find_authorized_key", return_value=root / "fake.ssh"), \
                 mock.patch.object(m, "gpg_executable", return_value="/usr/bin/gpg"), \
                 mock.patch.object(m, "make_ssh_command", return_value=["ssh", "PLACEHOLDER"]), \
                 mock.patch.object(m.subprocess, "run", return_value=target) as run_mock:
                m.diagnose()
            self.assertTrue(output.is_dir())
            self.assertFalse(list(output.iterdir()))
            args = run_mock.call_args.args[0]
            self.assertIn("bash -c", args[-1])
            self.assertIn("test -f", args[-1])
            self.assertNotIn("tar -C ", args[-1])
            self.assertNotIn("--passphrase-file", args[-1])

    def test_error_code_output_without_any_secret(self):
        old = sys.argv
        try:
            sys.argv = ["owner-export", "diagnose"]
            with mock.patch.object(m, "diagnose", side_effect=RuntimeError("GPG_NOT_AVAILABLE")), \
                 mock.patch.object(m.sys, "stderr", new_callable=io.StringIO) as sink:
                self.assertEqual(m.main(), 3)
                rendered = sink.getvalue()
            self.assertIn("OWNER_OFFSITE_REASON=GPG_NOT_AVAILABLE", rendered)
        finally:
            sys.argv = old

    def test_cli_help(self):
        p = subprocess.run([sys.executable, str(PATH), "--help"],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
        self.assertEqual(p.returncode, 0)
        self.assertIn(b"fetch", p.stdout)
        self.assertIn(b"verify", p.stdout)


if __name__ == "__main__":
    unittest.main()
