"""Static guardrails for privileged *disposable GitHub-hosted-only* dataplane lab."""
import pathlib
import unittest
ROOT = pathlib.Path(__file__).resolve().parent
WORKFLOW = ROOT.parent.parent / ".github/workflows/prhm-shared-ci-offline.yml"

class DisposableDataplaneLabContract(unittest.TestCase):
    def test_lab_only_runs_on_push_to_fixed_repo_branch(self):
        s = WORKFLOW.read_text()
        self.assertIn("disposable-nft-dataplane-lab:", s)
        self.assertIn("github.event_name == 'push'", s)
        self.assertIn("github.repository == 'prhmonline/prhm-host-actions'", s)
        self.assertIn("runs-on: ubuntu-24.04", s)
        self.assertIn("persist-credentials: false", s)
        self.assertIn("contents: read", s)
        self.assertIn('PRHM_CI_DISPOSABLE_LAB=yes', s)
        self.assertNotIn("runs-on: self-hosted", s)
        self.assertNotIn("environment: production", s)

    def test_nft_mutations_are_scoped_to_router_netns(self):
        s = (ROOT / "test_nft_dataplane_lab.sh").read_text()
        for line in s.splitlines():
            stripped = line.strip()
            if stripped.startswith("nft ") and not stripped.startswith("nft list table"):
                self.fail("Unscoped nft mutation: " + stripped)
            if stripped.startswith("sysctl -w"):
                self.fail("Host sysctl mutation: " + stripped)
        self.assertIn("ip netns exec cir47 nft --file", s)
        self.assertIn("ip netns exec cir47 nft delete table", s)
        self.assertIn("ip netns exec cir47 sysctl -qw net.ipv4.ip_forward=1", s)

    def test_synthetic_prod_address_is_namespace_only(self):
        s = (ROOT / "test_nft_dataplane_lab.sh").read_text()
        self.assertIn("ip -n cip47 address add 10.71.0.118/24 dev cip-peer47", s)
        self.assertIn("ip netns exec cip47 python3", s)
        self.assertIn("ip -n ciu47 address add 9.8.7.6/24 dev ciu-peer47", s)
        self.assertIn("ip netns exec cir47 python3", s)
        self.assertNotIn("ssh -", s)
        self.assertNotIn("curl ", s)
        self.assertNotIn("scp ", s)

    def test_baseline_before_guard_and_rollback_after(self):
        s = (ROOT / "test_nft_dataplane_lab.sh").read_text()
        pre = s.index("LAB_PRE_GUARD_CONNECTIVITY=PASS")
        guard = s.index("nft --file infra/shared-ci/ci-isolation.nft.review")
        post = s.index("LAB_POST_GUARD_ISOLATION=PASS")
        rollback = s.index("LAB_GUARD_ROLLBACK=PASS")
        self.assertLess(pre, guard)
        self.assertLess(guard, post)
        self.assertLess(post, rollback)

if __name__ == "__main__":
    unittest.main()
