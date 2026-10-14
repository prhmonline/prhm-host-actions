#!/usr/bin/env python3
"""Read-only transaction planner: no host I/O, no host changes, no approval.

Confirms owner-provided Node1 hook priorities and outputs ordered host stages
with expected safety checks. It does NOT generate executable root commands.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent

def prepare(manifest, observed):
    net = manifest["network"]
    vm = manifest["vm"]
    problems = []
    def require(condition, reason):
        if not condition:
            problems.append(reason)

    require(manifest["status"] == "REVIEW_ONLY", "manifest-not-review-only")
    require(net["name"] == "ci-net" and net["bridge"] == "virbr-ci" and
            net["subnet"] == "10.72.0.0/24", "unexpected-network-identity")
    require(vm["name"] == "prhm-shared-ci" and vm["concurrent_jobs"] == 1,
            "unexpected-vm-identity")
    require(observed["completeness"] == "PARTIAL_HOOK_SUMMARY_ONLY",
            "unexpected-baseline-provenance")
    require(observed["host"] == "server1.prhm.ir", "unexpected-target-host")
    zones = observed.get("firewalld_active_zones", {})
    require(zones.get("libvirt") == ["virbr-prod"] and
            zones.get("public") == ["eno1"], "production-zone-drift")
    require(observed.get("firewalld_policies") == ["allow-host-ipv6"],
            "firewalld-policy-drift")
    require(observed.get("planned_chain_priority") == -195,
            "unexpected-ci-guard-priority")

    # The proposed CI guard must run BEFORE all observed L3 INPUT/FORWARD
    # filter/mangle/security hooks, not compete at same priority.
    l3 = [h for name in ("nft_input_hooks", "nft_forward_hooks")
          for h in observed.get(name, []) if h.get("family") in ("ip", "ip6", "inet")]
    require(bool(l3), "no-observed-layer3-hooks")
    require(all(-195 < h["numeric_priority"] for h in l3),
            "existing-hook-precedes-ci-guard")
    require(observed.get("assertions", {}).get(
        "existing_production_zone_modification_allowed") is False,
        "production-zone-mutation-not-forbidden")

    preflight = [
        "Review signed Git SHA, preimage digests, and host hostname at apply time",
        "Verify libvirt ci-net/virbr-ci/10.72.0.0/24 and VM do NOT preexist",
        "Verify complete nftables/firewalld rule snapshot and libvirt prod-net XML hash",
        "Recheck Ubuntu base cloud image SHA against verified 20260705 signed release",
        "Test dedicated nft table with nft --check and isolated firewalld/libvirt simulation",
        "Prove source-controlled policy persists across firewalld reload and Node1 reboot",
        "Stage tested rollback and out-of-band host recovery without impacting Production",
        "Obtain explicit authorization for exact approved Git SHA and target Node1",
    ]
    stages = [
        {"id": "1", "name": "register_guard", "changes":
            "Install ONLY named prhm_ci_isolation nft table, before creating/connecting any CI guest"},
        {"id": "2", "name": "install_firewall_zone", "changes":
            "Create dedicated CI firewalld zone/policy for virbr-ci; allow only DNS/DHCP to local libvirt resolver and approved routed egress; never edit prod-net/libvirt zone or public zone"},
        {"id": "3", "name": "network_define", "changes":
            "Define ci-net in libvirt, no autostart; deny until matching named guard is active"},
        {"id": "4", "name": "guarded_network_start", "changes":
            "Start ci-net ONLY after guard and CI firewalld zone are installed and verified"},
        {"id": "5", "name": "guest_negative_probe", "changes":
            "Launch disposable network-test-only guest, prove DHCP/DNS, public HTTPS and negative TCP reachability to 10.71.0.0/24, Node1 management and other RFC1918, and IPv6; stop on any failure"},
        {"id": "6", "name": "ci_controller_vm", "changes":
            "Create VM with SHA-verified image, 4 vCPU/8GiB/80GiB and NO autostart/Production secrets; isolate disposable workers independently"},
        {"id": "7", "name": "runner_smoke", "changes":
            "Register one ephemeral no-secrets repository-scoped runner; verify actual start/PASS and destroy first disposable worker before enabling any additional repo"},
    ]
    rollback = [
        "Disable GitHub runner scheduling and revoke any registration token/identity",
        "Stop and remove only SHA-bound disposable workers and the CI VM",
        "Stop and undefine ONLY ci-net once no guest is connected",
        "Remove ONLY new CI firewalld zone entries and dedicated nft table after all CI interfaces are gone",
        "Verify production VM still running, prod-net unchanged, host routes, firewall preimages and external smoke checks",
        "If ownership, state or preimage differs, STOP; retain blocking rules and request operator recovery, never flush entire firewall",
    ]
    return {
        "schema": 1, "status": "REVIEW_ONLY",
        "baseline_kind": "PARTIAL_NOT_APPLY_SAFE",
        "ci_priority_precedes_observed_l3_hooks": not problems,
        "blocking_findings": problems + [
            "complete-live-nft-and-prod-net-preimage-not-supplied",
            "independent-host-apply-and-rollback-implementation-not-reviewed",
            "ci-bridge-firewalld-interoperability-not-live-tested",
            "guest-negative-network-proofs-not-captured",
        ],
        "apply_authorized": False,
        "host_changed": False,
        "preconditions": preflight,
        "planned_stages": stages,
        "rollback_order": rollback,
    }

def main():
    if len(sys.argv) != 1:
        raise SystemExit("zero command arguments only")
    manifest = json.loads((ROOT / "manifest.json").read_text())
    observed = json.loads((ROOT / "node1-observed-hooks-20261014.json").read_text())
    result = prepare(manifest, observed)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if not result["blocking_findings"] else 2

if __name__ == "__main__":
    sys.exit(main())
