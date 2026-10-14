"""Check a separately issued, signed, short-lived and exact Node1 Level-4 action.

Git manifest flags, PR reviews or prompt strings are NOT approval tokens.
The authorized control plane must place the signed statement into a root-only
runtime directory. Never create, edit, import keys or grant approval here.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time

BASE = Path("/run/prhm-approved/shared-ci-v1")
DOC = BASE / "statement.json"
SIG = BASE / "statement.sig"
PUB = Path("/etc/prhm-ci/trust/level4-node1-ed25519.pem")
HEX_SHA = re.compile(r"[0-9a-f]{40}\Z")
HEX_DIGEST = re.compile(r"[0-9a-f]{64}\Z")


class ApprovalRefused(RuntimeError):
    pass


def check_permissions(file, *, directory=False):
    if file.is_symlink() or not file.exists():
        raise ApprovalRefused("trusted Level-4 approval material absent/symlinked")
    s = file.stat()
    if s.st_uid != 0 or s.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise ApprovalRefused("Level-4 trusted material must be root-owned/non-writable")
    if directory and not stat.S_ISDIR(s.st_mode):
        raise ApprovalRefused("approval directory not a directory")
    if not directory and not stat.S_ISREG(s.st_mode):
        raise ApprovalRefused("approval material not a regular file")


def verify_external_level4(*, operation, revision, nft_digest, prod_xml_digest,
                           pinned_public_key_sha256, now=None):
    if operation != "stage" or not HEX_SHA.fullmatch(revision):
        raise ApprovalRefused("invalid exact authorized operation/revision")
    if not all(HEX_DIGEST.fullmatch(x or "") for x in
               (nft_digest, prod_xml_digest, pinned_public_key_sha256)):
        raise ApprovalRefused("preimage or independent key fingerprint missing")
    # Root must independently provision and pin this verification key.
    for p in (Path("/etc/prhm-ci"), Path("/etc/prhm-ci/trust"), BASE):
        check_permissions(p, directory=True)
    for p in (DOC, SIG, PUB):
        check_permissions(p)
    if hashlib.sha256(PUB.read_bytes()).hexdigest() != pinned_public_key_sha256:
        raise ApprovalRefused("verification key digest differs from audited manifest")
    raw = DOC.read_bytes()
    if len(raw) > 4096 or SIG.stat().st_size > 256:
        raise ApprovalRefused("approval payload exceeds fixed length limit")
    try:
        doc = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as e:
        raise ApprovalRefused("malformed signed Level-4 approval statement") from e
    expected_keys = {"schema", "operation", "host", "git_commit", "nft_preimage_sha256",
                     "prod_xml_preimage_sha256", "issued_at", "expires_at",
                     "request_id", "approval_level"}
    if set(doc) != expected_keys:
        raise ApprovalRefused("approval statement has missing or additional claims")
    if (doc["schema"] != 1 or doc["operation"] != operation
        or doc["host"] != "server1.prhm.ir"
        or doc["git_commit"] != revision
        or doc["nft_preimage_sha256"] != nft_digest
        or doc["prod_xml_preimage_sha256"] != prod_xml_digest
        or doc["approval_level"] != "LEVEL_4_CRITICAL"):
        raise ApprovalRefused("Level-4 signature claims not bound to staged change")
    if not isinstance(doc["request_id"], str) or not re.fullmatch(
            r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
            doc["request_id"]):
        raise ApprovalRefused("invalid one-time approval request ID")
    issued, expires = doc["issued_at"], doc["expires_at"]
    stamp = int(time.time()) if now is None else int(now)
    if not isinstance(issued, int) or not isinstance(expires, int) or (
        not (stamp - 300 <= issued <= stamp + 30) or
        not (issued < expires <= stamp + 300)):
        raise ApprovalRefused("signed approval outside narrow time window")
    try:
        p = subprocess.run(["openssl", "pkeyutl", "-verify", "-pubin",
                            "-inkey", str(PUB), "-rawin", "-in", str(DOC),
                            "-sigfile", str(SIG)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           check=False, timeout=10)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ApprovalRefused("verification process unavailable") from exc
    if p.returncode != 0:
        raise ApprovalRefused("Ed25519 approval signature invalid")
    return doc["request_id"]
