#!/usr/bin/env python3
import importlib.util
import json
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODFILE = ROOT / "ops" / "prhm-central-retention-plan.py"

spec = importlib.util.spec_from_file_location("retention", MODFILE)
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)

def b(day):
    return f"202609{day:02d}T010203Z.restic-repo.tar"

class RetentionTests(unittest.TestCase):
    def fixture(self, names, protected=None):
        td = tempfile.TemporaryDirectory()
        root = pathlib.Path(td.name)

        inv = root / "inventory.json"
        inv.write_text(
            json.dumps([{"Path": x, "Size": 100} for x in names]),
            encoding="utf-8"
        )

        state = root / "latest.json"
        if protected:
            state.write_text(json.dumps({
                "status": "pass",
                "remote": "gdrive-backup:PRHM-Backups/bundles/central/" + protected
            }), encoding="utf-8")

        return td, inv, state

    def test_eight_existing_current_prunes_one_oldest(self):
        names = [b(x) for x in range(1, 9)]
        td, inv, state = self.fixture(names, b(8))
        self.addCleanup(td.cleanup)

        self.assertEqual(
            retention.plan(b(8), str(state), str(inv)),
            [b(1)]
        )

    def test_seven_before_new_upload_prunes_to_six(self):
        names = [b(x) for x in range(1, 8)]
        td, inv, state = self.fixture(names, b(7))
        self.addCleanup(td.cleanup)

        self.assertEqual(
            retention.plan(b(8), str(state), str(inv)),
            [b(1)]
        )

    def test_never_deletes_latest_verified_bundle(self):
        names = [b(x) for x in range(1, 9)]
        td, inv, state = self.fixture(names, b(1))
        self.addCleanup(td.cleanup)

        plan = retention.plan(b(8), str(state), str(inv))
        self.assertNotIn(b(1), plan)
        self.assertEqual(len(plan), 1)

    def test_unexpected_remote_filename_fails_closed(self):
        names = [b(x) for x in range(1, 7)] + ["notes.txt"]
        td, inv, state = self.fixture(names, b(6))
        self.addCleanup(td.cleanup)

        with self.assertRaises(SystemExit):
            retention.plan(b(7), str(state), str(inv))

    def test_prune_requires_verified_state(self):
        names = [b(x) for x in range(1, 8)]
        td, inv, state = self.fixture(names)
        self.addCleanup(td.cleanup)

        with self.assertRaises(SystemExit):
            retention.plan(b(8), str(state), str(inv))

if __name__ == "__main__":
    unittest.main(verbosity=2)
