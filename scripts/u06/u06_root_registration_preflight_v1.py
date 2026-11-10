#!/usr/bin/env python3
"""U06 SHA-pinned ROOT REGISTRATION PRE-FLIGHT. No installation or DB access.

Run only on prhm-production as root after exact-source review. This program
does not write files, query MySQL, call Docker, read secret contents, modify
systemd, install a Host Action, or authorize any Production operation.
"""
import hashlib
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
from typing import Optional

HOST = "prhm-production.prhm.ir"
ACTION = "honartik_u06_native_backup_register_v1"
PROFILE_SHA = "79783874cb5170eec3dedcc536f713c4567c585e118f881c1035862a7bba8698"
ADAPTER_SHA = "d81223e31bde684f83d1b8b3c93a8fdf2bd4797db33159bf681e6d3898ade2a3"
PROFILE = "/etc/deploy-control/projects/honartik_back.production.json"
ADAPTER = "/usr/local/libexec/deploy-control/universal/current/universal/adapters/database.py"
CREDENTIAL = "/etc/deploy-control/secrets/honartik_back/mysql.cnf"
OWNERS = {
    "agent_api": "/opt/prhm-agent-selfmaint/server.js",
    "root_executor": "/opt/prhm-agent-selfmaint-exec/server.js",
    "agent3_mcp": "/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js",
    "approval_policy": "/opt/prhm-company-control-plane/config/approval-policy.json",
}

def file_metadata(filename: str, expected: Optional[str] = None, digest: bool = True) -> dict:
    """Return only filesystem metadata and SHA, never file contents."""
    p = Path(filename)
    try:
        st = p.lstat()
    except FileNotFoundError:
        return {"present": False}
    out = {
        "present": True,
        "regular_file": stat.S_ISREG(st.st_mode),
        "symlink": stat.S_ISLNK(st.st_mode),
        "owner_uid": st.st_uid,
        "owner_gid": st.st_gid,
        "mode": format(stat.S_IMODE(st.st_mode), "04o"),
        "bytes": st.st_size,
        "group_or_world_writable": bool(st.st_mode & 0o022),
    }
    if not out["regular_file"] or out["symlink"]:
        out["trusted_candidate"] = False
        return out
    if not digest:
        # The credential is a secret: never open it even for hashing.
        out["trusted_candidate"] = not out["group_or_world_writable"]
        return out
    # O_NOFOLLOW protects leaf. lstat/fstat inode identity prevents leaf swap.
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(p, flags)
    try:
        opened = os.fstat(fd)
        if (opened.st_dev, opened.st_ino) != (st.st_dev, st.st_ino):
            raise RuntimeError("file_changed_between_stat_and_open")
        h = hashlib.sha256()
        with os.fdopen(fd, "rb", closefd=False) as f:
            while True:
                chunk = f.read(1024 * 1024)
                if not chunk:
                    break
                h.update(chunk)
        out["sha256"] = h.hexdigest()
    finally:
        os.close(fd)
    out["expected_sha_match"] = (out["sha256"] == expected) if expected else None
    out["trusted_candidate"] = not out["group_or_world_writable"]
    return out

def detect_service() -> str:
    try:
        p = subprocess.run(
            ["/usr/bin/systemctl", "is-active", "prhm-agent-selfmaint-exec.service"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            universal_newlines=True, timeout=10, check=False
        )
        return p.stdout.strip() if p.returncode == 0 else "not-active"
    except (OSError, subprocess.SubprocessError):
        return "unknown"

def audit(*, root_required=True, path_overrides=None, detected_host=None) -> dict:
    if root_required and os.geteuid() != 0:
        raise RuntimeError("root_required_for_live_metadata")
    paths = {
        "profile": PROFILE,
        "adapter": ADAPTER,
        "credential": CREDENTIAL,
        **OWNERS,
    }
    if path_overrides:
        paths.update(path_overrides)
    hostname = detected_host if detected_host is not None else socket.getfqdn()
    profile = file_metadata(paths["profile"], PROFILE_SHA)
    adapter = file_metadata(paths["adapter"], ADAPTER_SHA)
    owners = {key: file_metadata(paths[key]) for key in OWNERS}
    credential = file_metadata(paths["credential"], digest=False)
    offsite = None
    if profile.get("expected_sha_match") is True:
        try:
            with open(paths["profile"], "rb") as f:
                data = json.load(f)
            value = data.get("backup", {}).get("offsite_required")
            offsite = value if isinstance(value, bool) else None
        except (OSError, ValueError, TypeError):
            pass
    sha_valid = (
        profile.get("expected_sha_match") is True
        and adapter.get("expected_sha_match") is True
    )
    owners_present = all(
        v.get("regular_file") and v.get("trusted_candidate")
        for v in owners.values()
    )
    return {
        "schema": "prhm.u06.root-registration-preflight.readonly.v1",
        "action": ACTION,
        "host": hostname,
        "host_match": hostname == HOST,
        "profile": profile,
        "adapter": adapter,
        "owner_preimages": owners,
        "credential_metadata": {
            "present": credential.get("present", False),
            "mode": credential.get("mode"),
            "owner_uid": credential.get("owner_uid"),
            "permissions_private": credential.get("mode") == "0600"
                if credential.get("present") else False,
        },
        "offsite_required": offsite,
        "root_executor_service": detect_service() if root_required else "fixture",
        "preimage_eligible_for_dedicated_review": (
            hostname == HOST and sha_valid and owners_present
            and credential.get("present") is False and offsite is False
        ),
        "root_action_registered": False,
        "root_action_installed": False,
        "owner_oidc_executed": False,
        "production_database_touched": False,
        "production_deploy_authorized": False,
        "next_phase": "review_sha_bound_native_root_registration",
    }

def main() -> int:
    if sys.argv[1:] != ["--audit"]:
        print("Usage: u06_root_registration_preflight_v1.py --audit (read-only)", file=sys.stderr)
        return 2
    try:
        result = audit()
    except Exception as e:
        print(json.dumps({
            "schema": "prhm.u06.root-registration-preflight.readonly.v1",
            "error": type(e).__name__,
            "preimage_eligible_for_dedicated_review": False,
            "production_deploy_authorized": False,
        }))
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["preimage_eligible_for_dedicated_review"] else 3

if __name__ == "__main__":
    raise SystemExit(main())
