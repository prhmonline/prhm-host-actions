"""Offline transaction-order and rollback safety contracts. No host actions."""
import copy
import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("shared_ci_plan", ROOT / "transaction-plan.py")
plan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plan)

def inputs():
    return (json.loads((ROOT / "manifest.json").read_text()),
            json.loads((ROOT / "node1-observed-hooks-20261014.json").read_text()))

class PlanContract(unittest.TestCase):
    def test_expected_hooks_precede_baseline_and_never_grant_apply(self):
        out = plan.prepare(*inputs())
        self.assertTrue(out["ci_priority_precedes_observed_l3_hooks"])
        self.assertFalse(out["apply_authorized"])
        self.assertFalse(out["host_changed"])
        self.assertEqual(out["status"], "REVIEW_ONLY")
        self.assertTrue(out["blocking_findings"])
        self.assertEqual(out["baseline_kind"], "PARTIAL_NOT_APPLY_SAFE")

    def test_any_unexpected_early_hook_fails_closed(self):
        manifest, baseline = inputs()
        baseline["nft_forward_hooks"].append({
            "family": "ip", "table": "unexpected", "numeric_priority": -250})
        out = plan.prepare(manifest, baseline)
        self.assertIn("existing-hook-precedes-ci-guard", out["blocking_findings"])
        self.assertFalse(out["apply_authorized"])

    def test_firewalld_or_production_zone_drift_fails_closed(self):
        m, evidence = inputs()
        evidence["firewalld_active_zones"]["libvirt"].append("virbr-ci")
        out = plan.prepare(m, evidence)
        self.assertIn("production-zone-drift", out["blocking_findings"])

    def test_order_guard_before_any_network_guest_and_cleanup_reverses(self):
        out = plan.prepare(*inputs())
        names = [x["name"] for x in out["planned_stages"]]
        self.assertEqual(names, [
            "register_guard", "install_firewall_zone", "network_define",
            "guarded_network_start", "guest_negative_probe",
            "ci_controller_vm", "runner_smoke"
        ])
        rollback = out["rollback_order"]
        self.assertIn("Stop and undefine ONLY ci-net", rollback[2])
        self.assertIn("Remove ONLY new CI firewalld zone", rollback[3])
        self.assertIn("STOP; retain blocking rules", rollback[-1])

    def test_no_unsanctioned_shell_or_state_write(self):
        code = (ROOT / "transaction-plan.py").read_text()
        for forbidden in ("subprocess", "os.system", "shell=True",
                          "write_text(", "write_bytes(", "net-define", "nft -f"):
            self.assertNotIn(forbidden, code)

if __name__ == "__main__":
    unittest.main()
