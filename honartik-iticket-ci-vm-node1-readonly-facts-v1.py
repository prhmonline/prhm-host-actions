#!/usr/bin/env python3
"""Exact read-only node1 libvirt guest eligibility facts, no arguments/writes."""
import hashlib
import json
import os
import platform
import shutil
import stat
import subprocess
import sys

IMAGE = "/var/lib/libvirt/images/base/noble-server-cloudimg-amd64.img"
DISK = "/var/lib/libvirt/images/honartik-iticket-ci.qcow2"


def call(command):
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            check=False, universal_newlines=True, timeout=20)
    if result.returncode != 0:
        raise RuntimeError("read_only_inventory_command_failed:" + command[0])
    return result.stdout.strip()


def mib_kib_available():
    with open("/proc/meminfo", encoding="ascii") as reader:
        for line in reader:
            if line.startswith("MemAvailable:"):
                return int(line.split()[1])
    raise RuntimeError("mem_available_missing")


def image_sha():
    if os.path.islink(IMAGE) or not os.path.isfile(IMAGE):
        raise RuntimeError("base_image_invalid")
    digest = hashlib.sha256()
    with open(IMAGE, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def facts():
    # Exact hypervisor identity; never return secrets, token or user data.
    host = call(["/usr/bin/hostname", "-f"])
    if host != "server1.prhm.ir":
        raise RuntimeError("not_the_approved_node1")
    kvm = os.stat("/dev/kvm")
    root = "/var/lib/libvirt/images"
    disk_bytes = os.statvfs(root)
    data = {
        "hostname": host,
        "architecture": platform.machine(),
        "kvm": stat.S_ISCHR(kvm.st_mode),
        "firewalld": call(["/usr/bin/systemctl", "is-active", "firewalld"]) == "active",
        "cpu_logical": os.cpu_count(),
        "mem_available_kib": mib_kib_available(),
        "storage_available_kib": (disk_bytes.f_bavail * disk_bytes.f_frsize) // 1024,
        "image_sha256": image_sha(),
        "domains": sorted(filter(None, call(["/usr/bin/virsh",
            "list", "--all", "--name"]).splitlines())),
        "networks": sorted(filter(None, call(["/usr/bin/virsh",
            "net-list", "--all", "--name"]).splitlines())),
        "target_disk_absent": not os.path.lexists(DISK),
        "virt_install": shutil.which("virt-install") is not None,
        "qemu_img": shutil.which("qemu-img") is not None,
        "genisoimage": shutil.which("genisoimage") is not None,
    }
    return data


if __name__ == "__main__":
    if len(sys.argv) != 1:
        raise SystemExit("ITICKET_CI_NODE1_INVENTORY=BLOCKED_ARGUMENTS_NOT_ALLOWED")
    try:
        print(json.dumps(facts(), sort_keys=True))
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        print("ITICKET_CI_NODE1_INVENTORY=BLOCKED_" +
              type(error).__name__, file=sys.stderr)
        raise SystemExit(2)
