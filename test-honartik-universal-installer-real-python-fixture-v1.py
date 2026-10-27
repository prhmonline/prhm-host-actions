#!/usr/bin/env python3
"""Issue #217: test the EXACT live Python install_bundle in an isolated fixture.

The installed engine's five source files must be copied into a non-root-owned
/tmp/prhm-honartik217-engine-fixture-* directory BEFORE running. Each SHA-256 is
pinned to a read-only production observation; no networking or production path
is used by these tests. This file has NO production installer/apply entrypoint.
"""
import hashlib
import importlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import uuid
from unittest import mock

LIVE_PINS = {
    "install.py": "4be5c770cc9c7075f11b06ea463a9bc65e399e19124beaaee01934f47b59433d",
    "io.py": "93be862ad6c03afb7e793a868e0701b96183e85c5108871afca34263c9bd8d86",
    "locks.py": "83f5403166cd537c67d65fcccdf6b5d8c8a08614220235f186f2bf21aac67d41",
    "config.py": "a2586c0825eadf0c9efa0bd9c9b53028d30c08bc8887e765189b35ff958db883",
    "models.py": "4b585ec21947bfaddd1f449cb49c85106d8c7f7d7e08cc6b688c4d4484832205",
}


def verified_engine():
    if not hasattr(os, "getuid") or os.getuid() == 0:
        raise RuntimeError("nonroot_linux_fixture_required")
    root = Path(os.environ.get("PRHM217_TEST_ENGINE_ROOT", ""))
    tmp = Path(tempfile.gettempdir()).resolve()
    if (not root.is_absolute() or root.parent != tmp or
            not root.name.startswith("prhm-honartik217-engine-fixture-")):
        raise RuntimeError("untrusted_engine_fixture_location")
    if root.is_symlink() or root.stat().st_uid != os.getuid() or (
            root.stat().st_mode & 0o777) != 0o700:
        raise RuntimeError("engine_fixture_owner_or_mode")
    package = root / "universal"
    if package.is_symlink() or not package.is_dir():
        raise RuntimeError("engine_package_missing")
    for name, expected in LIVE_PINS.items():
        p = package / name
        if p.is_symlink() or not p.is_file() or p.stat().st_uid != os.getuid():
            raise RuntimeError("engine_file_untrusted_" + name)
        if p.stat().st_mode & 0o022:
            raise RuntimeError("engine_file_writable_" + name)
        digest = hashlib.sha256(p.read_bytes()).hexdigest()
        if digest != expected:
            raise RuntimeError("live_engine_source_sha_mismatch_" + name)
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    module = importlib.import_module("universal.install")
    if Path(module.__file__).resolve() != (package / "install.py").resolve():
        raise RuntimeError("engine_import_escape")
    return module


INSTALL = verified_engine()


class RealPythonInstallerFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(
            prefix="prhm-honartik217-python-install-fixture-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.prefix = self.root / "managed"
        self.one = self._source("one")
        self.two = self._source("two")

    def _source(self, label):
        d = self.root / ("source-" + label) / "universal"
        d.mkdir(parents=True, mode=0o700)
        (d / "cli.py").write_text("print(" + repr(label) + ")\n")
        return d.parent

    def _install_first(self):
        digest = INSTALL.bundle_digest(self.one)
        result = INSTALL.install_bundle(self.one, self.prefix, digest, None)
        self.assertEqual(result["digest"], digest)
        return digest

    def _preimage(self):
        pointer = (self.prefix / "current").resolve()
        wrapper = self.prefix / "deploy-project"
        manifest = self.prefix / "installation.json"
        return {
            "pointer": pointer,
            "manifest": manifest.read_bytes(),
            "wrapper": wrapper.read_bytes(),
            "manifest_mode": manifest.stat().st_mode & 0o777,
            "wrapper_mode": wrapper.stat().st_mode & 0o777,
        }

    def _restore_fixture_only(self, old):
        """Compensating fixture restoration; NOT production crash durability."""
        ptr = self.prefix / "current"
        tmp = self.prefix / (".restore-" + uuid.uuid4().hex)
        tmp.symlink_to(old["pointer"])
        os.replace(tmp, ptr)
        for name in ("manifest", "wrapper"):
            p = self.prefix / ("installation.json" if name == "manifest"
                               else "deploy-project")
            INSTALL.atomic_write(p, old[name], old[name + "_mode"])
        self.assertEqual(ptr.resolve(), old["pointer"])
        self.assertEqual((self.prefix / "installation.json").read_bytes(),
                         old["manifest"])
        self.assertEqual((self.prefix / "deploy-project").read_bytes(),
                         old["wrapper"])
        self.assertEqual((self.prefix / "deploy-project").stat().st_mode & 0o777,
                         old["wrapper_mode"])

    def test_actual_live_installer_successive_bundle_cutover(self):
        old = self._install_first()
        desired = INSTALL.bundle_digest(self.two)
        got = INSTALL.install_bundle(self.two, self.prefix, desired, old)
        self.assertEqual(got["digest"], desired)
        self.assertEqual(got["previous"], old)
        self.assertEqual((self.prefix / "current").resolve().name, desired)
        self.assertEqual(json.loads(
            (self.prefix / "installation.json").read_text())["digest"], desired)

    def test_bad_candidate_digest_rejected_before_pointer(self):
        old = self._install_first()
        pre = self._preimage()
        with self.assertRaises(ValueError):
            INSTALL.install_bundle(self.two, self.prefix, "a"*64, old)
        self.assertEqual((self.prefix / "current").resolve(), pre["pointer"])

    def test_bad_current_digest_rejected_before_pointer(self):
        self._install_first()
        pre = self._preimage()
        desired = INSTALL.bundle_digest(self.two)
        with self.assertRaises(ValueError):
            INSTALL.install_bundle(self.two, self.prefix, desired, "0"*64)
        self.assertEqual((self.prefix / "current").resolve(), pre["pointer"])

    def test_wrapper_write_failure_restores_pointer(self):
        old = self._install_first()
        pre = self._preimage()
        desired = INSTALL.bundle_digest(self.two)
        original = INSTALL.atomic_write

        def fail_wrapper(file, data, mode):
            if Path(file).name == "deploy-project":
                raise OSError("injected_wrapper_failure")
            return original(file, data, mode)
        with mock.patch.object(INSTALL, "atomic_write", side_effect=fail_wrapper):
            with self.assertRaisesRegex(OSError, "injected_wrapper_failure"):
                INSTALL.install_bundle(self.two, self.prefix, desired, old)
        self.assertEqual((self.prefix / "current").resolve(), pre["pointer"])
        self.assertEqual((self.prefix / "installation.json").read_bytes(),
                         pre["manifest"])

    def test_manifest_write_failure_requires_external_recovery(self):
        old = self._install_first()
        pre = self._preimage()
        desired = INSTALL.bundle_digest(self.two)
        with mock.patch.object(INSTALL, "write_json",
                               side_effect=OSError("injected_manifest_failure")):
            with self.assertRaisesRegex(OSError, "injected_manifest_failure"):
                INSTALL.install_bundle(self.two, self.prefix, desired, old)
        # The installed function has changed current and wrapper already.
        self.assertEqual((self.prefix / "current").resolve().name, desired)
        self.assertEqual(json.loads(
            (self.prefix / "installation.json").read_text())["digest"], old)
        self._restore_fixture_only(pre)


    def _run_actual_install_crash(self, step):
        import subprocess
        old = self._install_first()
        pre = self._preimage()
        target = INSTALL.bundle_digest(self.two)
        script = """
import os
from pathlib import Path
import sys
engine_root = os.environ['PRHM217_TEST_ENGINE_ROOT']
sys.path.insert(0, engine_root)
from universal import install as i
root = Path(sys.argv[1])
old_sha = sys.argv[2]
target = i.bundle_digest(root / 'source-two')
assert os.getuid() != 0
assert root.parent == Path('/tmp') and root.name.startswith(
  'prhm-honartik217-python-install-fixture-')
step = sys.argv[3]
if step == 'after_pointer':
    real_replace = i.os.replace
    def replace_and_die(src,dst):
        real_replace(src,dst)
        if Path(dst) == root / 'managed' / 'current':
            os._exit(91)
    i.os.replace = replace_and_die
elif step == 'after_manifest':
    real_write = i.write_json
    def write_and_die(path,data):
        real_write(path,data)
        os._exit(93)
    i.write_json = write_and_die
else:
    raise RuntimeError('invalid_test_step')
i.install_bundle(root / 'source-two', root / 'managed', target, old_sha)
raise RuntimeError('unexpected_install_return')
"""
        child = subprocess.run(
            [sys.executable, "-c", script, str(self.root), old, step],
            capture_output=True, text=True, timeout=15,
            env={**os.environ, "PRHM217_TEST_ENGINE_ROOT":
                 os.environ["PRHM217_TEST_ENGINE_ROOT"]},
            check=False,
        )
        self.assertEqual(child.returncode,
                         91 if step == "after_pointer" else 93,
                         child.stderr)
        self.assertEqual((self.prefix / "current").resolve().name, target)
        actual_manifest = json.loads(
            (self.prefix / "installation.json").read_text())
        self.assertEqual(actual_manifest["digest"],
                         old if step == "after_pointer" else target)
        self._restore_fixture_only(pre)

    def test_hard_process_exit_after_real_pointer_write(self):
        self._run_actual_install_crash("after_pointer")

    def test_hard_process_exit_after_real_manifest_write(self):
        self._run_actual_install_crash("after_manifest")


if __name__ == "__main__":
    unittest.main()
