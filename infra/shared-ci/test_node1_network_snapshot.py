"""Offline Node1 firewall inventory contracts. Does not access Node1."""
import importlib.util
import json
import pathlib
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("ci_node1_snapshot", ROOT / "node1-network-snapshot.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def fixture():
    return {
        "nft": json.dumps({"nftables": [
            {"metainfo": {"version": "1.0.6"}},
            {"table": {"family": "inet", "name": "filter", "handle": 1}},
            {"chain": {"family": "inet", "table": "filter", "name": "forward",
                       "type": "filter", "hook": "forward", "prio": 0,
                       "policy": "accept", "handle": 2}},
            {"rule": {"family": "inet", "table": "filter", "chain": "forward",
                      "handle": 3, "expr": [{"counter": {"packets": 4, "bytes": 25}},
                                            {"accept": None}]}}
        ]}),
        "firewalld": "running\n",
        "zones": "libvirt\n interfaces: virbr-prod\npublic\n interfaces: eno1\n",
        "production_xml": '<network><name>prod-net</name><forward mode="nat"/><bridge name="virbr-prod"/><ip address="10.71.0.1"/></network>',
        "networks": "prod-net\n",
        "vms": "prhm-production\nimotion-directadmin\n",
        "routes": json.dumps([{"dst": "default"}, {"dst": "10.71.0.0/24"}]),
        "bridges": json.dumps([{"ifname": "virbr-prod"}]),
    }

class Node1SnapshotTests(unittest.TestCase):
    def test_expected_current_topology_is_ok_but_never_authorized(self):
        result = module.summarize(fixture())
        self.assertTrue(all(result["checks"].values()))
        self.assertFalse(result["ready_for_apply"])
        self.assertFalse(result["host_mutation_performed"])
        self.assertEqual(result["nft_hooks"][0]["hook"], "forward")
        self.assertEqual(len(result["nft_config_sha256"]), 64)

    def test_collision_fails_closed(self):
        base = fixture()
        base["networks"] += "ci-net\n"
        base["bridges"] = json.dumps([{"ifname": "virbr-prod"}, {"ifname": "virbr-ci"}])
        base["routes"] = json.dumps([{"dst": "10.72.0.0/24"}])
        base["vms"] += "prhm-shared-ci\n"
        result = module.summarize(base)
        for key in ("network_ci_net_absent", "bridge_virbr_ci_absent",
                    "vm_prhm_shared_ci_absent", "proposed_cidr_not_routed"):
            self.assertFalse(result["checks"][key], key)

    def test_missing_forward_baseline_fails_closed(self):
        base = fixture()
        nft = json.loads(base["nft"])
        nft["nftables"] = [entry for entry in nft["nftables"] if "chain" not in entry]
        base["nft"] = json.dumps(nft)
        self.assertFalse(module.summarize(base)["checks"]["forward_hook_present"])

    def test_missing_prod_route_fails_closed(self):
        base = fixture()
        base["routes"] = json.dumps([{"dst": "default"}])
        self.assertFalse(module.summarize(base)["checks"]["prod_route_present"])

    def test_missing_prod_bridge_fails_closed(self):
        base = fixture()
        base["bridges"] = json.dumps([])
        self.assertFalse(module.summarize(base)["checks"]["prod_net_bridge_present"])

    def test_existing_table_collision_rejected(self):
        base = fixture()
        raw = json.loads(base["nft"])
        raw["nftables"].append({"table": {"family": "inet", "name": "prhm_ci_isolation"}})
        base["nft"] = json.dumps(raw)
        self.assertFalse(module.summarize(base)["checks"]["no_existing_prhm_ci_nft_table"])

    def test_changed_production_topology_rejected(self):
        base = fixture()
        base["production_xml"] = base["production_xml"].replace("10.71.0.1", "10.71.0.2")
        self.assertFalse(module.summarize(base)["checks"]["prod_net_expected_topology"])

    def test_normalization_ignores_rule_counters_and_handles(self):
        first = json.loads(fixture()["nft"])
        second = json.loads(fixture()["nft"])
        rule = second["nftables"][3]["rule"]
        rule["expr"][0]["counter"]["packets"] = 20000
        rule["expr"][0]["counter"]["bytes"] = 400000
        rule["handle"] = 1000
        self.assertEqual(module.canonical_nft(first), module.canonical_nft(second))
        rule["expr"][1] = {"drop": None}
        self.assertNotEqual(module.canonical_nft(first), module.canonical_nft(second))

    def test_arbitrary_command_not_allowed(self):
        with self.assertRaises(ValueError):
            module.read_command("nft", "-f", "/tmp/unsafe.nft")
        with self.assertRaises(ValueError):
            module.read_command("virsh", "net-define", "/tmp/x.xml")
        with self.assertRaises(ValueError):
            module.read_command("bash", "-c", "touch /tmp/file")

    def test_no_mutation_or_secret_dump(self):
        code = (ROOT / "node1-network-snapshot.py").read_text()
        for banned in ("shell=True", "sudo ", "nft -f ", "virsh net-define",
                       "virsh define ", "write_text(", "write_bytes(", "open(\"/etc"):
            self.assertNotIn(banned, code)

if __name__ == "__main__":
    unittest.main()
