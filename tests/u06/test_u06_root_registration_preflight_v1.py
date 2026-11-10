import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[2]
SCRIPT = HERE / "scripts" / "u06" / "u06_root_registration_preflight_v1.py"
spec = importlib.util.spec_from_file_location("u06_preflight", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="u06-offline-")
        self.root = Path(self.tmp.name)
        self.files = {}
        for key in ("profile", "adapter", "credential", *mod.OWNERS):
            p = self.root / key
            self.files[key] = str(p)
        # We never store real production secrets or data in these tests.
        self._write("profile", b'{"backup":{"offsite_required":false}}')
        self._write("adapter", b"test native adapter")
        for name in mod.OWNERS:
            self._write(name, b"fixture root owner")
    def tearDown(self):
        self.tmp.cleanup()
    def _write(self, key, data):
        p = Path(self.files[key])
        p.write_bytes(data)
        p.chmod(0o600)
    def test_metadata_sha_only_no_file_content_leak(self):
        m = mod.file_metadata(self.files["agent_api"])
        self.assertEqual(m["bytes"], len(b"fixture root owner"))
        self.assertNotIn("content", m)
        self.assertNotIn("fixture root owner", json.dumps(m))
        self.assertTrue(m["trusted_candidate"])
    def test_missing_credential_and_offsite_are_reported(self):
        r = mod.audit(root_required=False, path_overrides=self.files,
                      detected_host=mod.HOST)
        self.assertIs(r["offsite_required"], None) # SHA mismatch: refuses unpinned JSON
        self.assertFalse(r["credential_metadata"]["present"])
        self.assertFalse(r["preimage_eligible_for_dedicated_review"])
        self.assertFalse(r["production_deploy_authorized"])
    def test_symlink_is_not_followed(self):
        Path(self.files["adapter"]).unlink()
        os.symlink(self.files["profile"], self.files["adapter"])
        m = mod.file_metadata(self.files["adapter"])
        self.assertTrue(m["symlink"])
        self.assertFalse(m["trusted_candidate"])
        self.assertNotIn("sha256", m)
    def test_world_writable_owner_denied(self):
        p = Path(self.files["root_executor"])
        p.chmod(0o666)
        m = mod.file_metadata(str(p))
        self.assertTrue(m["group_or_world_writable"])
        self.assertFalse(m["trusted_candidate"])
    def test_invalid_host_rejected(self):
        r = mod.audit(root_required=False, path_overrides=self.files,
                      detected_host="not-prhm-production.example")
        self.assertFalse(r["host_match"])
    def test_cli_has_no_apply_mode(self):
        source = SCRIPT.read_text()
        self.assertIn('["--audit"]', source)
        self.assertNotIn('"--apply"', source)
        self.assertNotIn("CREATE USER", source)
        self.assertNotIn("DROP USER", source)

if __name__ == "__main__":
    unittest.main()
