#!/usr/bin/env python3
"""Read-only, zero-argument Node1 shared-CI preflight; no VM/network/runner mutations."""
import hashlib
import importlib.util
import ipaddress
import json
import pathlib
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent
MANIFEST = ROOT / "manifest.json"
FORBIDDEN_EXEC = ("define", "create", "start", "destroy", "install", "attach", "modify")

def cmd(*argv):
    # Fixed, local, read-only probes. No shell, environment, user-controlled command.
    allowed = {
        ("virsh", "list", "--all", "--name"),
        ("virsh", "net-list", "--all", "--name"),
        ("virsh", "net-dumpxml", "prod-net"),
        ("virsh", "pool-info", "vm-storage"),
        ("ip", "-4", "route"),
        ("firewall-cmd", "--state"),
    }
    if tuple(argv) not in allowed:
        raise ValueError("probe not allowlisted")
    result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            encoding="utf-8", timeout=12, check=False)
    if result.returncode != 0:
        raise RuntimeError("%s failed with exit code %s" % (argv[0], result.returncode))
    return result.stdout

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def check_route_overlap(routes, cidr):
    wanted = ipaddress.ip_network(cidr, strict=True)
    for line in routes.splitlines():
        first = line.split()
        if not first or "/" not in first[0]:
            continue
        try:
            existing = ipaddress.ip_network(first[0], strict=False)
        except ValueError:
            continue
        if wanted.overlaps(existing):
            return True
    return False

def inspect():
    conf = json.loads(MANIFEST.read_text(encoding="utf-8"))
    issues, passed = [], []
    def gate(condition, name, detail):
        (passed if condition else issues).append(name if condition else name + ": " + detail)

    image = pathlib.Path(conf["image"]["path"])
    sums = pathlib.Path(conf["image"]["sums"])
    gate(image.is_file(), "image_present", "base Ubuntu image absent")
    gate(sums.is_file(), "checksum_present", "local SHA256SUMS file absent")
    if image.is_file() and sums.is_file():
        actual = sha256(image)
        rows = [ln.split() for ln in sums.read_text(encoding="utf-8").splitlines()]
        matches = [r[0] for r in rows if len(r) >= 2 and
                   r[-1].removeprefix("*").removeprefix("./") == image.name]
        gate(len(matches) == 1 and matches[0] == conf["image"]["sha256"] == actual,
             "image_local_hash", "hash mismatch, missing or duplicate checksum entry")

    # A local checksums file alone is not proof of vendor authenticity.
    # Imported verifier is read-only; absent trusted keyring fails closed.
    signer_script = ROOT / "image-signature.py"
    if signer_script.is_file():
        try:
            spec = importlib.util.spec_from_file_location("prhm_ci_image_signature", signer_script)
            if spec is None or spec.loader is None:
                raise ValueError("signer loader missing")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            authentic, signer_reason = module.verify(conf)
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
            authentic, signer_reason = False, "signature verifier failed: " + type(exc).__name__
    else:
        authentic, signer_reason = False, "signature verifier missing"
    gate(authentic, "ubuntu_publisher_signature", signer_reason)
    gate(shutil.which("virsh") is not None and shutil.which("ip") is not None,
         "libvirt_commands_present", "virsh/ip missing")
    if shutil.which("virsh"):
        try:
            vms = cmd("virsh", "list", "--all", "--name").splitlines()
            nets = cmd("virsh", "net-list", "--all", "--name").splitlines()
            gate(conf["vm"]["name"] not in vms, "vm_name_unused", "target VM already exists")
            gate(conf["network"]["name"] not in nets, "net_name_unused", "target network already exists")
            prod = ET.fromstring(cmd("virsh", "net-dumpxml", "prod-net"))
            bridge, ip = prod.find("bridge"), prod.find("ip")
            gate(prod.findtext("name") == "prod-net" and
                 bridge is not None and bridge.attrib.get("name") == "virbr-prod" and
                 ip is not None and ip.attrib.get("address") == "10.71.0.1",
                 "prod_net_unchanged", "existing prod bridge/subnet differs from audit")
            pool = cmd("virsh", "pool-info", "vm-storage")
            gate("State:" in pool, "pool_detected", "pool info missing")
        except (RuntimeError, ValueError, ET.ParseError, KeyError) as exc:
            issues.append("libvirt_readonly_audit: " + type(exc).__name__)
    if shutil.which("ip"):
        try:
            routes = cmd("ip", "-4", "route")
            gate(not check_route_overlap(routes, conf["network"]["subnet"]),
                 "ci_subnet_unused", "routing overlaps proposed CI subnet")
        except RuntimeError:
            issues.append("route_readonly_audit: failed")
    if shutil.which("firewall-cmd"):
        try:
            gate(cmd("firewall-cmd", "--state").strip() == "running",
                 "firewalld_running", "firewalld disabled")
        except RuntimeError:
            issues.append("firewalld_readonly_audit: failed")
    else:
        issues.append("firewalld_present: missing")

    # Existing host read probes cannot prove guest isolation. No firewall apply here.
    gate(False, "ci_network_isolation",
         "not configured; needs reviewed policy and negative guest connectivity tests")
    gate(False, "one_job_runner_teardown",
         "no ephemeral runner installed or teardown evidence")
    gate(False, "github_selfhosted_job_scheduled",
         "must demonstrate a started/completed job despite GitHub account billing limit")
    return {"project": conf["project"], "mode": "READ_ONLY",
            "ready_for_host_mutation": False, "pass": passed, "blockers": issues}

def main():
    if len(sys.argv) != 1:
        raise SystemExit("no arguments allowed")
    result = inspect()
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 2 if result["blockers"] else 0

if __name__ == "__main__":
    sys.exit(main())
