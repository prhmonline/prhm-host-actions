#!/usr/bin/env python3
"""Reviewed-commit-only, two-phase Node1 staging of an INACTIVE CI network.

No VM, guest, runner, firewalld zone, production network, libvirt daemon or
existing nft table is ever modified. \`plan\` is read-only. \`stage\`/ \`rollback\`
are explicit root actions for a separately authorized operator, never
invoked by GitHub CI. Boot activation/guest use is NOT implemented.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "manifest.json"
XML = ROOT / "ci-net.xml.review"
NFT = ROOT / "ci-isolation.nft.review"
STATE = Path("/var/lib/prhm-ci/network-stage-v1.json")
REGISTRY = Path("/var/lib/prhm-ci")
RELEASE_RE = re.compile(r"[0-9a-f]{40}\Z")
SUBNET = "10.72.0.0/24"
EXPECTED_IMAGE_SHA = "ffe6203da54deeb6db5d2a98a83f9ec8e55f149d3f7ba622e1abe5fa966ee3d6"


class Stop(RuntimeError):
    pass


def run(*argv):
    p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       text=True, timeout=35, check=False)
    if p.returncode != 0:
        raise Stop(f"command failed: {argv[0]} {argv[1] if len(argv)>1 else ''} ({p.returncode})")
    return p.stdout


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_checkout(reviewed):
    if not RELEASE_RE.fullmatch(reviewed):
        raise Stop("invalid reviewed SHA")
    top = ROOT.parent.parent
    if os.geteuid() != 0:
        raise Stop("root operator required")
    if top.is_symlink() or ROOT.is_symlink() or XML.is_symlink() or NFT.is_symlink():
        raise Stop("symlink source forbidden")
    # All source ancestors must be root-controlled for a privileged interpreter.
    for check in (top, top / "infra", ROOT, XML, NFT, MANIFEST, Path(__file__)):
        st = check.stat()
        if st.st_uid != 0 or st.st_mode & 0o022:
            raise Stop("source must be root-owned and not group/world writable")
    if run("git", "-C", str(top), "rev-parse", "HEAD").strip() != reviewed:
        raise Stop("Git HEAD mismatch")
    if run("git", "-C", str(top), "status", "--porcelain", "--untracked-files=all").strip():
        raise Stop("Git tree dirty")
    tree = run("git", "-C", str(top), "rev-parse", "--show-toplevel").strip()
    if Path(tree).resolve() != top.resolve():
        raise Stop("Git worktree is not script root")
    return top


def check_design():
    m = json.loads(MANIFEST.read_text())
    if m.get("status") != "REVIEW_ONLY" or m.get("network", {}).get("name") != "ci-net":
        raise Stop("manifest review gate mismatch")
    if m["network"].get("bridge") != "virbr-ci" or m["network"].get("subnet") != SUBNET:
        raise Stop("wrong bridge or subnet")
    if m.get("vm", {}).get("name") != "prhm-shared-ci":
        raise Stop("wrong VM")
    if m["image"]["sha256"] != EXPECTED_IMAGE_SHA:
        raise Stop("Ubuntu image digest drift")
    tree = ET.fromstring(XML.read_text())
    bridge = tree.find("bridge")
    net_ip = tree.find("ip")
    if tree.findtext("name") != "ci-net" or bridge is None or net_ip is None:
        raise Stop("libvirt XML not for exact ci-net")
    if bridge.get("name") != "virbr-ci" or net_ip.get("address") != "10.72.0.1":
        raise Stop("libvirt XML target mismatch")
    if tree.find("forward") is None or tree.find("forward").get("mode") != "nat":
        raise Stop("libvirt XML NAT mismatch")
    if "table inet prhm_ci_isolation {" not in NFT.read_text():
        raise Stop("reviewed nft file missing dedicated table")
    return {"xml_sha256": sha256(XML), "nft_sha256": sha256(NFT)}


def live_baseline():
    if run("hostname", "-f").strip() != "server1.prhm.ir":
        raise Stop("wrong Node1 host")
    if run("firewall-cmd", "--state").strip() != "running":
        raise Stop("firewalld offline")
    zones = run("firewall-cmd", "--get-active-zones")
    if "virbr-prod" not in zones or "eno1" not in zones or "virbr-ci" in zones:
        raise Stop("unexpected firewall zones")
    prod = ET.fromstring(run("virsh", "net-dumpxml", "prod-net"))
    bridge, ip, forward = prod.find("bridge"), prod.find("ip"), prod.find("forward")
    if not (prod.findtext("name") == "prod-net" and bridge is not None
            and bridge.get("name") == "virbr-prod" and ip is not None
            and ip.get("address") == "10.71.0.1" and forward is not None
            and forward.get("mode") == "nat"):
        raise Stop("prod-net drift")
    if "prhm-production" not in run("virsh", "list", "--all", "--name").splitlines():
        raise Stop("production VM missing")
    if run("virsh", "domstate", "prhm-production").strip() != "running":
        raise Stop("production VM not running")
    routes = run("ip", "-4", "route")
    if not any(line.startswith("10.71.0.0/24 ") and "virbr-prod" in line
               for line in routes.splitlines()):
        raise Stop("Production route drift")
    if any(line.startswith("10.72.0.0/24 ") for line in routes.splitlines()):
        raise Stop("new subnet collision")
    if "ci-net" in run("virsh", "net-list", "--all", "--name").splitlines():
        raise Stop("ci-net name already exists")
    if "prhm-shared-ci" in run("virsh", "list", "--all", "--name").splitlines():
        raise Stop("CI VM already exists")
    if "virbr-ci" in run("ip", "-br", "link"):
        raise Stop("CI bridge already exists")
    # MUST be absent rather than replacing or modifying another actor's nft table.
    if subprocess.run(["nft", "list", "table", "inet", "prhm_ci_isolation"],
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                      timeout=15).returncode == 0:
        raise Stop("CI nft table already exists")
    # Check only; no live firewall mutation.
    run("nft", "-c", "-f", str(NFT))
    return {"host": "server1.prhm.ir", "prod_net_unchanged": True,
            "production_vm_running": True, "ci_resources_absent": True}


def write_state(data):
    if STATE.exists() or STATE.is_symlink():
        raise Stop("network stage journal already exists")
    if REGISTRY.is_symlink():
        raise Stop("journal root symlink")
    if not REGISTRY.exists():
        REGISTRY.mkdir(mode=0o700)
    st = REGISTRY.stat()
    if st.st_uid != 0 or st.st_mode & 0o077:
        raise Stop("journal root permissions unsafe")
    fd, tmp = tempfile.mkstemp(prefix=".ci-", dir=REGISTRY)
    try:
        with os.fdopen(fd, "w") as file:
            json.dump(data, file, sort_keys=True)
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
        os.chmod(tmp, 0o600)
        # Exclusive journal creation (do not overwrite preexisting state).
        os.link(tmp, STATE)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def state_guard():
    if STATE.is_symlink() or not STATE.is_file():
        raise Stop("journal missing or symlinked")
    stat = STATE.stat()
    if stat.st_uid != 0 or stat.st_mode & 0o077:
        raise Stop("journal owner/perms unsafe")
    s = json.loads(STATE.read_text())
    if s.get("kind") != "prhm-ci-network-stage-v1" or s.get("network") != "ci-net":
        raise Stop("foreign journal; manual recovery required")
    if not RELEASE_RE.fullmatch(s.get("sha", "")):
        raise Stop("journal SHA invalid")
    return s


def guard_exists():
    return subprocess.run(["nft", "list", "table", "inet", "prhm_ci_isolation"],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                          timeout=15).returncode == 0


def verify_inactive():
    if "ci-net" not in run("virsh", "net-list", "--all", "--name").splitlines():
        raise Stop("ci-net definition missing")
    info = run("virsh", "net-info", "ci-net")
    for field in ("Active:", "Autostart:"):
        entries = [x.split(":", 1)[1].strip().lower() for x in info.splitlines()
                   if x.startswith(field)]
        if entries != ["no"]:
            raise Stop("CI network active or autostarting")
    if not guard_exists():
        raise Stop("CI guard unexpectedly absent")
    if "prhm-production" not in run("virsh", "list", "--all", "--name").splitlines():
        raise Stop("Production VM disappeared")
    if run("virsh", "domstate", "prhm-production").strip() != "running":
        raise Stop("Production VM not running")


def staged_apply(sha):
    blobs = check_design()
    live_baseline()
    if STATE.exists() or STATE.is_symlink():
        raise Stop("stage journal exists; refusing replay")
    # Distinct table added without flushing or touching any other nft table.
    run("nft", "-f", str(NFT))
    try:
        if not guard_exists():
            raise Stop("nft guard not installed")
        run("virsh", "net-define", str(XML))
        verify_inactive()
        write_state({"kind": "prhm-ci-network-stage-v1", "network": "ci-net",
                     "sha": sha, "files": blobs, "network_started": False,
                     "production_modified": False})
    except Exception:
        # Never delete an active network or remove the guard if rollback
        # cannot prove the network inactive and exclusively ours.
        nets = run("virsh", "net-list", "--all", "--name").splitlines()
        if "ci-net" in nets:
            info = run("virsh", "net-info", "ci-net")
            if not all(any(x.startswith(k) and x.split(":", 1)[1].strip().lower() == "no"
                           for x in info.splitlines()) for k in ("Active:", "Autostart:")):
                raise Stop("CI network state uncertain; guard retained")
            run("virsh", "net-undefine", "ci-net")
        run("nft", "delete", "table", "inet", "prhm_ci_isolation")
        raise
    return {"stage": "DEFINED_INACTIVE_ONLY", "network_active": False,
            "rollback_available": True, "sha": sha, "changes_to_prod": False}


def rollback(sha):
    s = state_guard()
    if s["sha"] != sha or s["files"] != check_design():
        raise Stop("SHA or file drift; cannot safely rollback")
    verify_inactive()
    run("virsh", "net-undefine", "ci-net")
    if "ci-net" in run("virsh", "net-list", "--all", "--name").splitlines():
        raise Stop("ci-net still present; retain guard")
    run("nft", "delete", "table", "inet", "prhm_ci_isolation")
    if guard_exists():
        raise Stop("guard still exists")
    STATE.unlink()
    return {"stage": "ROLLED_BACK", "removed_only": ["ci-net", "prhm_ci_isolation"],
            "production_modified": False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=("plan", "stage", "rollback"))
    parser.add_argument("--reviewed-sha", required=True)
    args = parser.parse_args()
    try:
        check_checkout(args.reviewed_sha)
        blobs = check_design()
        if args.operation == "plan":
            result = {"operation": "plan", "mode": "READ_ONLY",
                      "design": blobs, "baseline": live_baseline(),
                      "ready_to_stage": False, "reason": "Owner SHA approval required for stage"}
        elif args.operation == "stage":
            result = staged_apply(args.reviewed_sha)
        else:
            result = rollback(args.reviewed_sha)
        print(json.dumps({"ok": True, **result}, sort_keys=True))
        return 0
    except (Stop, OSError, ValueError, ET.ParseError, subprocess.TimeoutExpired,
            json.JSONDecodeError) as error:
        print(json.dumps({"ok": False, "mode": args.operation,
                          "error": str(error)[:250], "fail_closed": True},
                         sort_keys=True), file=sys.stderr)
        return 2

if __name__ == "__main__":
    sys.exit(main())
