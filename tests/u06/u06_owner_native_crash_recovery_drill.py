#!/usr/bin/env python3
"""U06 Linux crash journal drill: SIGKILL + durable restore in throwaway paths.

This executes real filesystem fsync, rename, SIGKILL and reboot-style recovery
logic, but NEVER connects to MySQL or opens any project/production files.

All targets are allocated inside one fresh TemporaryDirectory. This is a
recovery *rehearsal*, not a production Native Root adapter or its admission.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile


ORIGINAL = b'{"project":"honartik_back","offsite_required":false}\n'
CHANGED = b'{"project":"honartik_back","offsite_required":true}\n'
STAGES = ("journal_fsynced", "profile_replaced", "recovery_staged")
PREFIX = "prhm-u06-crash-test-"
CHILD = r"""
import base64, hashlib, json, os, pathlib, signal, sys
root=pathlib.Path(sys.argv[1])
mode=sys.argv[2]
target=root/'profile.json'
journal=root/'rollback.json'
def syncdir(p):
    fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
def atomic(p,data):
    tmp=p.with_suffix(p.suffix+'.next')
    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        os.write(fd,data)
        os.fsync(fd)
    finally:os.close(fd)
    os.replace(tmp,p)
    syncdir(root)
if mode=='journal_fsynced' or mode=='profile_replaced':
    original=target.read_bytes()
    data=json.dumps({
        'schema':'prhm.u06.clone-crash-journal.v1',
        'target':'profile.json',
        'original_sha256':hashlib.sha256(original).hexdigest(),
        'original_b64':base64.b64encode(original).decode('ascii'),
        'original_mode':384,
        'state':'PREPARED'
    },sort_keys=True).encode()+b'\n'
    fd=os.open(journal,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:os.write(fd,data);os.fsync(fd)
    finally:os.close(fd)
    syncdir(root)
    if mode=='profile_replaced':
        atomic(target,b'{"project":"honartik_back","offsite_required":true}\n')
elif mode=='recovery_staged':
    evidence=json.loads(journal.read_bytes())
    previous=base64.b64decode(evidence['original_b64'],validate=True)
    tmp=root/'profile.json.next'
    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:os.write(fd,previous);os.fsync(fd)
    finally:os.close(fd)
    syncdir(root)
else:
    raise RuntimeError('unsupported_test_stage')
os.kill(os.getpid(),signal.SIGKILL)
"""


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def syncdir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def run_crash(root: Path, stage: str) -> None:
    result = subprocess.run(
        [sys.executable, "-c", CHILD, str(root), stage],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        timeout=18,
        check=False,
    )
    if result.returncode != -signal.SIGKILL:
        raise RuntimeError("SIGKILL_NOT_OBSERVED_" + stage)


def trusted_recover(root: Path) -> None:
    if not root.name.startswith(PREFIX) or root.is_symlink():
        raise ValueError("outside_disposable_test_root")
    journal = root / "rollback.json"
    mode = journal.lstat()
    if (not stat.S_ISREG(mode.st_mode)
            or stat.S_IMODE(mode.st_mode) != 0o600
            or mode.st_uid != os.geteuid()):
        raise ValueError("untrusted_recovery_journal")
    data = json.loads(journal.read_bytes())
    if (data.get("schema") != "prhm.u06.clone-crash-journal.v1"
            or data.get("target") != "profile.json"
            or data.get("state") != "PREPARED"
            or data.get("original_mode") != 0o600):
        raise ValueError("recovery_journal_binding_invalid")
    previous = base64.b64decode(data["original_b64"], validate=True)
    if sha(previous) != data["original_sha256"]:
        raise ValueError("recovery_preimage_checksum_failed")
    source = root / "profile.json"
    # A previous SIGKILL may leave an already-fsynced temp file.
    stale = root / "profile.json.next"
    if stale.exists():
        statinfo = stale.lstat()
        if (not stat.S_ISREG(statinfo.st_mode)
                or stat.S_IMODE(statinfo.st_mode) != 0o600):
            raise ValueError("suspicious_recovery_temp")
        stale.unlink()
        syncdir(root)
    fd = os.open(stale, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        if os.write(fd, previous) != len(previous):
            raise OSError("short_recovery_write")
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(stale, source)
    syncdir(root)
    if sha(source.read_bytes()) != sha(ORIGINAL):
        raise ValueError("recovered_profile_checksum_mismatch")


def scenario(stage: str) -> dict:
    with tempfile.TemporaryDirectory(prefix=PREFIX) as name:
        root = Path(name)
        os.chmod(root, 0o700)
        src = root / "profile.json"
        src.write_bytes(ORIGINAL)
        src.chmod(0o600)
        syncdir(root)
        run_crash(root, "profile_replaced" if stage == "recovery_staged" else stage)
        before = src.read_bytes()
        if stage == "journal_fsynced" and before != ORIGINAL:
            raise RuntimeError("journal_stage_changed_profile")
        if stage != "journal_fsynced" and before != CHANGED:
            raise RuntimeError("mutation_stage_did_not_change_disposable_profile")
        if stage == "recovery_staged":
            run_crash(root, "recovery_staged")
            if not (root / "profile.json.next").exists():
                raise RuntimeError("recovery_crash_fixture_missing")
        trusted_recover(root)
        trusted_recover(root)  # idempotent after a second recovery/restart
        result = {
            "stage": stage,
            "real_sigkill_observed": True,
            "source_restore_sha256_verified": sha(src.read_bytes()) == sha(ORIGINAL),
            "journal_retained_for_audit": (root / "rollback.json").is_file(),
            "recovery_temp_clean": not (root / "profile.json.next").exists(),
            "file_mode_private": stat.S_IMODE(src.stat().st_mode) == 0o600,
        }
        if not all(v is True for k, v in result.items() if k != "stage"):
            raise RuntimeError("recovery_incomplete_" + stage)
        return result


def main() -> int:
    outcomes = [scenario(stage) for stage in STAGES]
    print(json.dumps({
        "schema": "prhm.u06.owner-native-real-sigkill-sandbox-drill.v1",
        "origin": "disposable-linux-filesystem-only",
        "profile_live_file_read_or_written": False,
        "db_connection_used": False,
        "root_policy_modified": False,
        "production_release_authorized": False,
        "cases": outcomes,
        "result": "PASS",
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
