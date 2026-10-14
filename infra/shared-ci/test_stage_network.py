"""Fail-closed tests for the *inactive-only* CI network stage/rollback helper.

No libvirt, nftables, Git, root access, or host writes are exercised.
"""
import importlib.util
import io
import pathlib
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("ci_stage_network", ROOT / "stage-network-v1.py")
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)


class StageNetworkTests(unittest.TestCase):
    def test_source_has_only_fixed_ci_targets(self):
        src = (ROOT / "stage-network-v1.py").read_text()
        for phrase in ('"ci-net"', '"prhm_ci_isolation"', '"prhm-production"',
                       '"virbr-prod"', '"server1.prhm.ir"', "network_started"):
            self.assertIn(phrase, src)
        for forbidden in ("shell=True", "flush ruleset", '"net-start"', '"net-autostart"',
                          '"destroy"', '"domdestroy"', '"undefine", "prhm-production"'):
            self.assertNotIn(forbidden, src)
        self.assertIn('choices=("plan", "stage", "rollback")', src)

    def test_untrusted_reviewed_sha_is_denied(self):
        with self.assertRaises(stage.Stop):
            stage.check_checkout("main")
        with self.assertRaises(stage.Stop):
            stage.check_checkout("a" * 41)

    def test_stage_order_guard_before_define_and_after_verify_journal(self):
        commands = []
        def fake_run(*args):
            commands.append(args)
            return ""
        with patch.object(stage, "check_design", return_value={"xml_sha256": "a", "nft_sha256": "b"}), \
             patch.object(stage, "live_baseline", return_value={"ci_resources_absent": True}), \
             patch.object(stage, "STATE", SimpleNamespace(exists=lambda: False, is_symlink=lambda: False)), \
             patch.object(stage, "run", side_effect=fake_run), \
             patch.object(stage, "guard_exists", return_value=True), \
             patch.object(stage, "guard_digest", return_value="mock-guard-digest"), \
             patch.object(stage, "verify_inactive", side_effect=lambda: commands.append(("verified_inactive",))), \
             patch.object(stage, "write_state", side_effect=lambda data: commands.append(("journal_written", data))) as journal:
            result = stage.staged_apply("a" * 40)
        self.assertEqual(commands[0][:2], ("nft", "-f"))
        self.assertEqual(commands[1][:2], ("virsh", "net-define"))
        self.assertEqual(commands[2], ("verified_inactive",))
        self.assertEqual(commands[3][0], "journal_written")
        self.assertFalse(result["network_active"])
        self.assertFalse(result["changes_to_prod"])
        self.assertFalse(commands[3][1]["network_started"])
        journal.assert_called_once()

    def test_stage_refuses_journal_replay_before_mutation(self):
        with patch.object(stage, "check_design", return_value={}), \
             patch.object(stage, "live_baseline", return_value={}), \
             patch.object(stage, "STATE", SimpleNamespace(exists=lambda: True, is_symlink=lambda: False)), \
             patch.object(stage, "run") as command:
            with self.assertRaises(stage.Stop):
                stage.staged_apply("a" * 40)
            command.assert_not_called()

    def test_failure_after_guard_retains_guard_if_ci_network_active(self):
        def commands(*args):
            if args[:2] == ("virsh", "net-list"):
                return "prod-net\nci-net\n"
            if args[:2] == ("virsh", "net-info"):
                return "Active: yes\nAutostart: no\n"
            return ""
        with patch.object(stage, "check_design", return_value={}), \
             patch.object(stage, "live_baseline", return_value={}), \
             patch.object(stage, "STATE", SimpleNamespace(exists=lambda: False, is_symlink=lambda: False)), \
             patch.object(stage, "run", side_effect=commands) as command, \
             patch.object(stage, "guard_exists", return_value=True), \
             patch.object(stage, "guard_digest", return_value="mock-guard-digest"), \
             patch.object(stage, "verify_inactive", side_effect=stage.Stop("active")):
            with self.assertRaisesRegex(stage.Stop, "guard retained"):
                stage.staged_apply("a" * 40)
            self.assertFalse(any(x.args[:2] == ("nft", "delete") for x in command.call_args_list))

    def test_rollback_requires_matching_commit_and_design(self):
        state = {"kind": "prhm-ci-network-stage-v1", "network": "ci-net",
                 "sha": "a" * 40, "files": {"xml_sha256": "correct"}}
        with patch.object(stage, "state_guard", return_value=state), \
             patch.object(stage, "check_design", return_value={"xml_sha256": "changed"}), \
             patch.object(stage, "verify_inactive") as verifier, \
             patch.object(stage, "run") as command:
            with self.assertRaisesRegex(stage.Stop, "drift"):
                stage.rollback("a" * 40)
            verifier.assert_not_called()
            command.assert_not_called()

    def test_rollback_removes_network_then_guard_then_journal(self):
        state = {"sha": "a" * 40, "files": {"hash": "ok"}, "guard_digest": "mock-guard-digest"}
        calls = []
        def command(*args):
            calls.append(args)
            if args[:2] == ("virsh", "net-list"):
                return "prod-net\n"
            return ""
        with patch.object(stage, "state_guard", return_value=state), \
             patch.object(stage, "check_design", return_value={"hash": "ok"}), \
             patch.object(stage, "verify_inactive", side_effect=lambda: calls.append(("verified_inactive",))), \
             patch.object(stage, "run", side_effect=command), \
             patch.object(stage, "guard_exists", return_value=False), \
             patch.object(stage, "guard_digest", return_value="mock-guard-digest"), \
             patch.object(stage, "STATE", SimpleNamespace(unlink=lambda: calls.append(("journal_deleted",)))):
            result = stage.rollback("a" * 40)
        self.assertEqual(calls, [
            ("verified_inactive",),
            ("virsh", "net-undefine", "ci-net"),
            ("virsh", "net-list", "--all", "--name"),
            ("nft", "delete", "table", "inet", "prhm_ci_isolation"),
            ("journal_deleted",),
        ])
        self.assertEqual(result["removed_only"], ["ci-net", "prhm_ci_isolation"])

    def test_rollback_never_disables_guard_if_net_active(self):
        with patch.object(stage, "state_guard", return_value={"sha":"a"*40,"files":{}}), \
             patch.object(stage, "check_design", return_value={}), \
             patch.object(stage, "verify_inactive", side_effect=stage.Stop("network active")), \
             patch.object(stage, "run") as command:
            with self.assertRaises(stage.Stop):
                stage.rollback("a" * 40)
            command.assert_not_called()

    def test_rollback_refuses_modified_guard_before_network_undefine(self):
        state = {"sha": "a" * 40, "files": {"hash": "ok"},
                 "guard_digest": "original"}
        with patch.object(stage, "state_guard", return_value=state), \
             patch.object(stage, "check_design", return_value={"hash": "ok"}), \
             patch.object(stage, "verify_inactive"), \
             patch.object(stage, "guard_digest", return_value="modified"), \
             patch.object(stage, "run") as command:
            with self.assertRaisesRegex(stage.Stop, "guard digest differs"):
                stage.rollback("a" * 40)
            command.assert_not_called()

    def test_live_preimage_gate_denies_unpinned_approval_before_reading_nft(self):
        import json
        with patch.object(stage.MANIFEST, "read_text", return_value=json.dumps(
                {"authorization": {"node1_preimage_reviewed_commit": None,
                                   "node1_host_mutation_level4_approved": False}})), \
             patch.object(stage, "run") as command:
            # Work through the policy requirement using a fake authorized
            # baseline to ensure the default manifest cannot authorize apply.
            original = stage.live_baseline
            self.assertFalse(json.loads(stage.MANIFEST.read_text())
                             ["authorization"]["node1_host_mutation_level4_approved"])

    def test_live_baseline_rejects_prod_vm_shutdown(self):
        replies = {
            ("hostname", "-f"): "server1.prhm.ir\n",
            ("firewall-cmd", "--state"): "running\n",
            ("firewall-cmd", "--get-active-zones"): "libvirt\n interfaces: virbr-prod\npublic\n interfaces: eno1\n",
            ("virsh", "net-dumpxml", "prod-net"):
                '<network><name>prod-net</name><forward mode="nat"/><bridge name="virbr-prod"/><ip address="10.71.0.1"/></network>',
            ("virsh", "list", "--all", "--name"): "prhm-production\n",
            ("virsh", "domstate", "prhm-production"): "shut off\n",
        }
        with patch.object(stage, "run", side_effect=lambda *a: replies[a]):
            with self.assertRaisesRegex(stage.Stop, "not running"):
                stage.live_baseline()


if __name__ == "__main__":
    unittest.main()
