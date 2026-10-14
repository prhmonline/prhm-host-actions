#!/usr/bin/env python3
"""Node1 read-only infrastructure baseline for PRHM Shared CI.

Zero input parameters. No shell, secrets, files, package installs, writes, network
connections, approval grant, or libvirt/firewall mutation. Emits bounded summary.
"""
import hashlib
import ipaddress
import json
import os
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

ALLOWED = {
    ("nft", "-j", "-a", "list", "ruleset"),
    ("firewall-cmd", "--state"),
    ("firewall-cmd", "--get-active-zones"),
    ("virsh", "net-dumpxml", "prod-net"),
    ("virsh", "net-list", "--all", "--name"),
    ("virsh", "list", "--all", "--name"),
    ("ip", "-j", "-4", "route"),
    ("ip", "-j", "link", "show", "type", "bridge"),
}
MAX_BYTES = 4 * 1024 * 1024
NET = ipaddress.ip_network("10.72.0.0/24")

def read_command(*args):
    if tuple(args) not in ALLOWED:
        raise ValueError("command-not-allowlisted")
    if not shutil.which(args[0]):
        raise RuntimeError("required-tool-missing: " + args[0])
    p = subprocess.run(
        args, input=None, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        check=False, timeout=20
    )
    if p.returncode != 0:
        raise RuntimeError("read-command-failed: " + args[0])
    if len(p.stdout) > MAX_BYTES:
        raise RuntimeError("read-output-limit-exceeded: " + args[0])
    return p.stdout.decode("utf-8", errors="strict")

def canonical_nft(data):
    """Ignore packet/byte counters and handles; preserve chains and rule expressions."""
    def clean(v):
        if isinstance(v, list):
            return [clean(x) for x in v]
        if isinstance(v, dict):
            return {k: clean(x) for k, x in v.items()
                    if k not in ("handle", "packets", "bytes", "metainfo")}
        return v
    return clean(data)

def nft_hooks(data):
    result = []
    counts = {}
    for entry in data.get("nftables", []):
        ch = entry.get("chain")
        if ch and "hook" in ch:
            result.append({
                "family": ch.get("family"),
                "table": ch.get("table"),
                "name": ch.get("name"),
                "hook": ch.get("hook"),
                "priority": ch.get("prio"),
                "policy": ch.get("policy"),
            })
        rule = entry.get("rule")
        if rule:
            name = "/".join(str(rule.get(k, "")) for k in ("family", "table", "chain"))
            counts[name] = counts.get(name, 0) + 1
    return sorted(result, key=lambda z: tuple(str(z.get(k)) for k in
                                             ("family", "hook", "priority", "table", "name"))), counts

def has_route_overlap(routes):
    for item in routes:
        dst = item.get("dst", "")
        try:
            candidate = ipaddress.ip_network(dst, strict=False)
        except ValueError:
            continue
        if candidate.version == 4 and candidate.overlaps(NET):
            return True
    return False

def summarize(texts):
    nft = json.loads(texts["nft"])
    routes = json.loads(texts["routes"])
    links = json.loads(texts["bridges"])
    prod = ET.fromstring(texts["production_xml"])
    bridge, ip, forward = prod.find("bridge"), prod.find("ip"), prod.find("forward")
    prod_verified = (
        prod.findtext("name") == "prod-net"
        and bridge is not None and bridge.get("name") == "virbr-prod"
        and ip is not None and ip.get("address") == "10.71.0.1"
        and forward is not None and forward.get("mode") == "nat"
    )
    bridges = sorted(x.get("ifname", "") for x in links)
    vms = set(texts["vms"].splitlines())
    networks = set(texts["networks"].splitlines())
    hooks, counts = nft_hooks(nft)
    normalized = json.dumps(canonical_nft(nft), sort_keys=True, separators=(",", ":"))
    checks = {
        "prod_net_expected_topology": prod_verified,
        "network_ci_net_absent": "ci-net" not in networks,
        "bridge_virbr_ci_absent": "virbr-ci" not in bridges,
        "vm_prhm_shared_ci_absent": "prhm-shared-ci" not in vms,
        "proposed_cidr_not_routed": not has_route_overlap(routes),
        "firewalld_running": texts["firewalld"].strip() == "running",
        "no_existing_prhm_ci_nft_table": not any(
            e.get("table", {}).get("name") == "prhm_ci_isolation"
            for e in nft.get("nftables", [])
        ),
        "prod_vm_present": "prhm-production" in vms,
    }
    return {
        "schema": 1, "mode": "READ_ONLY", "host_mutation_performed": False,
        "production_network_unchanged_by_probe": True,
        "checks": checks,
        "ready_for_apply": False, # Requires independently reviewed apply/rollback, never signoff here
        "nft_hooks": hooks,
        "nft_rule_counts": counts,
        "firewalld_active_zones": [
            row.strip() for row in texts["zones"].splitlines()
            if row.strip() and not row.lstrip().startswith("sources:")
        ][:24],
        "bridges": bridges,
        "nft_config_sha256": hashlib.sha256(normalized.encode("utf-8")).hexdigest(),
        "prod_net_xml_sha256": hashlib.sha256(
            texts["production_xml"].encode("utf-8")).hexdigest(),
        "note": "This inventory is not proof of CI network isolation. No live rules are applied."
    }

def main():
    if len(sys.argv) != 1:
        raise SystemExit("no arguments accepted")
    try:
        if os.geteuid() != 0:
            raise RuntimeError("read-only inventory requires root permissions")
        texts = {
            "nft": read_command("nft", "-j", "-a", "list", "ruleset"),
            "firewalld": read_command("firewall-cmd", "--state"),
            "zones": read_command("firewall-cmd", "--get-active-zones"),
            "production_xml": read_command("virsh", "net-dumpxml", "prod-net"),
            "networks": read_command("virsh", "net-list", "--all", "--name"),
            "vms": read_command("virsh", "list", "--all", "--name"),
            "routes": read_command("ip", "-j", "-4", "route"),
            "bridges": read_command("ip", "-j", "link", "show", "type", "bridge"),
        }
        result = summarize(texts)
        result["snapshot_complete"] = all(result["checks"].values())
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0 if result["snapshot_complete"] else 2
    except (RuntimeError, ValueError, ET.ParseError, KeyError, TypeError, UnicodeError,
            json.JSONDecodeError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({
            "schema": 1, "mode": "READ_ONLY", "snapshot_complete": False,
            "ready_for_apply": False, "error": str(exc)[:140]
        }))
        return 2

if __name__ == "__main__":
    sys.exit(main())
