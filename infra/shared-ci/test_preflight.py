"""Offline gates; no Node1, GitHub or filesystem mutations."""
import importlib.util
import json
import pathlib
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("prhm_shared_ci_preflight", ROOT / "preflight.py")
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)

class SharedCIContractTests(unittest.TestCase):
    def test_manifest_explicit_review_only(self):
        m = json.loads((ROOT / "manifest.json").read_text())
        self.assertEqual(m["status"], "REVIEW_ONLY")
        self.assertTrue(m["authorization"]["git_first"])
        self.assertFalse(m["authorization"]["production_operations"])
        self.assertEqual(m["vm"]["name"], "prhm-shared-ci")
        self.assertEqual(m["network"]["name"], "ci-net")
        self.assertNotEqual(m["network"]["subnet"], "10.71.0.0/24")
        self.assertEqual(m["runners"]["mode"], "per-repository-ephemeral")
        self.assertFalse(m["runners"]["production_deploy"])

    def test_no_arbitrary_command(self):
        with self.assertRaises(ValueError):
            preflight.cmd("virsh", "net-define", "/tmp/ci-net.xml")
        with self.assertRaises(ValueError):
            preflight.cmd("sh", "-c", "id")
        with self.assertRaises(ValueError):
            preflight.cmd("virsh", "destroy", "prhm-production")

    def test_route_collisions(self):
        routes = "default via 185.191.76.137 dev eno1\n10.71.0.0/24 dev virbr-prod\n"
        self.assertFalse(preflight.check_route_overlap(routes, "10.72.0.0/24"))
        self.assertTrue(preflight.check_route_overlap(routes + "10.72.0.0/24 dev virbr-ci\n", "10.72.0.0/24"))
        self.assertTrue(preflight.check_route_overlap("10.0.0.0/8 dev wg0\n", "10.72.0.0/24"))

    def test_signature_missing_fails_closed_even_if_other_checks_pass(self):
        with patch.object(preflight, "sha256", return_value="x"), \
             patch.object(preflight.pathlib.Path, "is_file", return_value=False), \
             patch.object(preflight.shutil, "which", return_value=None):
            result = preflight.inspect()
        self.assertFalse(result["ready_for_host_mutation"])
        names = " | ".join(result["blockers"])
        self.assertIn("ubuntu_publisher_signature", names)
        self.assertIn("ci_network_isolation", names)
        self.assertIn("one_job_runner_teardown", names)
        self.assertIn("github_selfhosted_job_scheduled", names)

    def test_vetting_is_separate_from_mutation(self):
        script = (ROOT / "preflight.py").read_text()
        self.assertNotIn("shell=True", script)
        self.assertNotIn("os.system(", script)
        self.assertNotIn("virsh net-define", script)
        self.assertNotIn("virsh define", script)

if __name__ == "__main__":
    unittest.main()
