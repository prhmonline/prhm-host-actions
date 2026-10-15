#!/usr/bin/env python3
"""Read-only offline Ubuntu cloud image authenticity verifier.

Inputs must point to the SAME Ubuntu image build and separately authenticated
Ubuntu cloud-image signing keyring. Never imports/downloads keys or writes.
The manifest has no trusted keyring until reviewed host provisioning.
"""
import json
import os
import pathlib
import re
import stat
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
MANIFEST = ROOT / "manifest.json"
UBUNTU_CLOUD_IMAGE_SIGNER = "D2EB44626FDDC30B513D5BB71A5D6C4C7DB87C81"


def valid_signature_status(status, expected_fingerprint):
    if not re.fullmatch(r"[0-9A-F]{40}", expected_fingerprint or ""):
        return False
    for line in status.splitlines():
        parts = line.strip().split()
        if len(parts) < 4 or parts[:2] != ["[GNUPG:]", "VALIDSIG"]:
            continue
        # VALIDSIG identifies the signing key and, if a subkey signs,
        # includes the primary-key fingerprint later in the status line.
        fingerprints = {x for x in parts[2:] if re.fullmatch(r"[0-9A-F]{40}", x)}
        if expected_fingerprint in fingerprints:
            return True
    return False


def verify(manifest):
    image = manifest["image"]
    keyring = image.get("vendor_keyring")
    fingerprint = image.get("expected_signer_fingerprint")
    if fingerprint != UBUNTU_CLOUD_IMAGE_SIGNER:
        return False, "trusted signer fingerprint is not pinned to Ubuntu documentation"
    if not keyring or not str(keyring).startswith("/etc/prhm-ci/trust/"):
        return False, "trusted vendor keyring must be in approved root-owned /etc/prhm-ci/trust/"
    sig, sums, keyring_file = [pathlib.Path(x) for x in
                               (image.get("sig", ""), image.get("sums", ""), keyring)]
    if not all(p.is_file() and not p.is_symlink() for p in (sig, sums, keyring_file)):
        return False, "missing or symlinked signature/checksum/trust files"
    trusted_root = pathlib.Path("/etc/prhm-ci/trust")
    if not trusted_root.is_dir() or trusted_root.is_symlink():
        return False, "trusted keyring directory absent or symlinked"
    # A forged local keyring must not be able to replace the trusted signer.
    for obj in (pathlib.Path("/etc/prhm-ci"), trusted_root, keyring_file):
        info = obj.stat()
        if info.st_uid != 0 or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH) or obj.is_symlink():
            return False, "vendor keyring or parent is not root-owned and write protected"
    try:
        output = subprocess.run(
            ["gpgv", "--status-fd", "1", "--keyring", str(keyring_file),
             str(sig), str(sums)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, timeout=25, check=False)
    except (FileNotFoundError, subprocess.TimeoutExpired, PermissionError):
        return False, "gpgv unavailable, timed out or inaccessible"
    if output.returncode != 0 or not valid_signature_status(output.stdout, fingerprint):
        return False, "signature invalid or signer fingerprint mismatch"
    return True, "signed checksum authenticated (compare exact image bytes separately)"


def main():
    if len(sys.argv) != 1:
        raise SystemExit("no arguments")
    try:
        config = json.loads(MANIFEST.read_text(encoding="utf-8"))
        ok, detail = verify(config)
    except (OSError, ValueError, KeyError, TypeError) as error:
        ok, detail = False, "invalid manifest/trust input: " + type(error).__name__
    print(json.dumps({"authentic_signature": ok, "detail": detail}))
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
