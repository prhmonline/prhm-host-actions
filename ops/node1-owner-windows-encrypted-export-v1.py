#!/usr/bin/env python3
"""No-billing, no-Google-API owner backup: SSH encrypted stream to Windows.

Runs ONLY on owner's Windows computer; transfers an AES256-encrypted tar stream
from the central guest over an authenticated SSH jump through Node1. Node1
and the central guest are read-only. This utility never accesses cloud APIs.

Commands:
  py -3 node1-owner-windows-encrypted-export-v1.py fetch
  py -3 node1-owner-windows-encrypted-export-v1.py verify --file PATH
  py -3 node1-owner-windows-encrypted-export-v1.py verify --file PATH --expected-sha256 DIGEST
"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import platform
import re
import shlex
import shutil
import socket
import subprocess
import sys
import tarfile

SNAPSHOT = "20261010T180405Z"
REMOTE_ROOT = "/var/backups/prhm-node1-hostdata-v1"
APPROVED_RELEASE_SHA = "7e31b704fd144e0b59ddf15dc8b7d204192fe9cf"
WINDOWS_PUBLIC_KEY_FINGERPRINT = "SHA256:WEd6aCEVqn+FE6Yx8sTWBUfmsbKwNxz70M+x+HZsr0Q"
JUMP = "root@185.191.76.138:40222"
CENTRAL = "root@10.71.0.118"
NODE1 = "root@185.191.76.138"
KEY_FILENAME = "node1-hostdata-gpg.passphrase"
RECEIPT_FILENAME = "node1-hostdata-escrow.json"
CHUNK = 1024 * 1024
MIN_ENCRYPTED_BYTES = 100000000
MAX_ENCRYPTED_BYTES = 10000000000


def stop(message):
    raise RuntimeError(message)


def assert_owner_windows():
    hostname = socket.getfqdn().lower()
    if platform.system() != "Windows" or any(x in hostname for x in
                                              ("node1", "prhm-production", "server1.prhm.ir")):
        stop("OWNER_WINDOWS_DEVICE_REQUIRED")


def owner_paths():
    base = pathlib.Path.home()
    key_directory = base / "PRHM-Node1-Recovery"
    out_directory = base / "PRHM-Node1-Encrypted-Exports"
    return key_directory, out_directory


def check_receipt(key_dir):
    secret_path = key_dir / KEY_FILENAME
    receipt_path = key_dir / RECEIPT_FILENAME
    if any(f.is_symlink() or not f.is_file() for f in (secret_path, receipt_path)):
        stop("OFF_DEVICE_KEY_OR_RECEIPT_MISSING")
    key = secret_path.read_bytes().rstrip(b"\r\n")
    if not 48 <= len(key) <= 256 or b"\r" in key or b"\n" in key:
        stop("INVALID_OWNER_KEY_FORMAT")
    receipt = json.loads(receipt_path.read_text(encoding="utf-8-sig"))
    if (receipt.get("schema") != "prhm.offsite-key-escrow.v1"
            or receipt.get("confirmed_by") != "owner"
            or receipt.get("independent_physical_copy_confirmed") is not True
            or receipt.get("verification") != "OWNER_ATTESTED_DISTINCT_RECOVERY_AND_GPG_DECRYPTION"
            or receipt.get("key_sha256") != hashlib.sha256(key).hexdigest()):
        stop("OWNER_KEY_RECOVERY_NOT_VERIFIED")
    return secret_path


def find_authorized_key():
    ssh_keygen = shutil.which("ssh-keygen")
    if not ssh_keygen:
        stop("OPENSSH_KEYGEN_NOT_AVAILABLE")
    key_candidates = []
    for pub in (pathlib.Path.home() / ".ssh").glob("*.pub"):
        if not pub.is_file():
            continue
        p = subprocess.run([ssh_keygen, "-lf", str(pub), "-E", "sha256"],
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                           timeout=10)
        if p.returncode == 0 and WINDOWS_PUBLIC_KEY_FINGERPRINT in p.stdout.decode("ascii", "replace"):
            private = pathlib.Path(str(pub)[:-4])
            if private.is_file():
                key_candidates.append(private)
    if len(key_candidates) != 1:
        stop("EXPECTED_ONE_PREVIOUSLY_AUTHORIZED_WINDOWS_SSH_KEY")
    return key_candidates[0]


def gpg_executable():
    paths = [shutil.which("gpg"), shutil.which("gpg.exe")]
    if os.name == "nt":
        for base in (os.environ.get("ProgramFiles"),
                     os.environ.get("ProgramFiles(x86)")):
            if base:
                paths.extend([str(pathlib.Path(base) / "GnuPG" / "bin" / "gpg.exe"),
                              str(pathlib.Path(base) / "Gpg4win" / "bin" / "gpg.exe")])
    for p in paths:
        if p and pathlib.Path(p).is_file():
            return p
    stop("GPG_NOT_AVAILABLE")


def remote_command():
    # Deliberately FIXED snapshot and destinations; never interpolate user input.
    source = ( "set -eu; cd " + shlex.quote(REMOTE_ROOT + "/" + SNAPSHOT)
               + "; test -f COMPLETE; sha256sum -c SHA256SUMS >/dev/null"
               + "; tar -C " + shlex.quote(REMOTE_ROOT)
               + " -cf - " + shlex.quote(SNAPSHOT) )
    inner = (
        "set -euo pipefail; "
        "/usr/bin/ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "
        "-o ConnectTimeout=15 " + NODE1 + " " + shlex.quote(source)
        + " | /usr/bin/gpg --batch --no-tty --pinentry-mode loopback"
        + " --passphrase-file /etc/prhm-backup/physical-offsite/node1-hostdata-gpg.passphrase"
        + " --symmetric --cipher-algo AES256 --compress-algo none"
        + " --s2k-digest-algo SHA256 --output -"
    )
    return "bash -o pipefail -c " + shlex.quote(inner)


def make_ssh_command(key):
    client = shutil.which("ssh")
    if not client:
        stop("WINDOWS_OPENSSH_CLIENT_NOT_AVAILABLE")
    return [client, "-T", "-i", str(key), "-o", "IdentitiesOnly=yes",
            "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=20",
            "-J", JUMP, CENTRAL, remote_command()]


def sha_file(path):
    digest = hashlib.sha256()
    with open(str(path), "rb") as f:
        while True:
            buf = f.read(CHUNK)
            if not buf:
                break
            digest.update(buf)
    return digest.hexdigest()


def verify_archive(path, local_key, expected_digest=None):
    if expected_digest is not None:
        if not re.fullmatch(r"[0-9a-fA-F]{64}", expected_digest):
            stop("EXPECTED_DIGEST_INVALID")
        actual = sha_file(path)
        if actual.lower() != expected_digest.lower():
            stop("ENCRYPTED_CLOUD_BYTES_MISMATCH")
    proc = subprocess.Popen(
        [gpg_executable(), "--batch", "--no-tty", "--pinentry-mode", "loopback",
         "--passphrase-file", str(local_key), "--decrypt", str(path)],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    checksums = {}
    small_members = {}
    complete = False
    try:
        with tarfile.open(fileobj=proc.stdout, mode="r|") as tar:
            for member in tar:
                if member.isdir() and member.name.rstrip("/") == SNAPSHOT:
                    continue
                if not member.name.startswith(SNAPSHOT + "/"):
                    stop("UNEXPECTED_TAR_PREFIX")
                if not member.isfile():
                    continue
                name = member.name[len(SNAPSHOT) + 1:]
                if name.startswith("/") or ".." in pathlib.PurePosixPath(name).parts:
                    stop("UNSAFE_TAR_NAME")
                stream = tar.extractfile(member)
                if stream is None:
                    stop("UNREADABLE_TAR_ENTRY")
                digest = hashlib.sha256()
                retained = bytearray()
                while True:
                    chunk = stream.read(CHUNK)
                    if not chunk:
                        break
                    digest.update(chunk)
                    if name in ("SHA256SUMS", "db/database_names.txt",
                                "files/coverage-proof.json") and len(retained) < 100000:
                        retained.extend(chunk)
                checksums[name] = digest.hexdigest()
                if name in ("SHA256SUMS", "db/database_names.txt",
                            "files/coverage-proof.json"):
                    if len(retained) > 100000:
                        stop("UNEXPECTED_METADATA_SIZE")
                    small_members[name] = bytes(retained)
                if name == "COMPLETE":
                    complete = True
        proc.stdout.close()
        if proc.wait(timeout=60) != 0:
            stop("GPG_DECRYPTION_FAILED")
    except BaseException:
        if proc.stdout is not None and not proc.stdout.closed:
            proc.stdout.close()
        if proc.poll() is None:
            proc.kill()
            proc.wait()
        raise
    if not complete:
        stop("MISSING_COMPLETE_MARKER")
    if not all(x in checksums for x in ("SHA256SUMS", "MANIFEST",
                                        "db/all-databases.sql.gz",
                                        "files/node1-hostdata.tar.zst",
                                        "files/coverage-proof.json",
                                        "db/database_names.txt")):
        stop("INCOMPLETE_BACKUP_MEMBERS")
    manifest = small_members["SHA256SUMS"].decode("ascii").splitlines()
    for line in manifest:
        bits = line.split("  ", 1)
        if len(bits) != 2 or checksums.get(bits[1]) != bits[0]:
            stop("ORIGINAL_SHA256SUMS_MISMATCH")
    coverage = json.loads(small_members["files/coverage-proof.json"].decode("utf-8"))
    dbs = small_members["db/database_names.txt"].decode("utf-8").splitlines()
    if (coverage.get("ok") is not True or coverage.get("ratio", 0) < .95
            or coverage.get("site_regular_files", 0) < 1000 or len(dbs) < 6):
        stop("RESTORE_COVERAGE_NOT_PROVEN")
    return {"files_checked": len(manifest), "database_count": len(dbs),
            "site_regular_files": coverage["site_regular_files"]}


def fetch():
    assert_owner_windows()
    key_dir, out_dir = owner_paths()
    local_key = check_receipt(key_dir)
    ssh_identity = find_authorized_key()
    gpg_executable()
    out_dir.mkdir(exist_ok=True)
    if shutil.disk_usage(str(out_dir)).free < 3 * 1024**3:
        stop("NOT_ENOUGH_INDEPENDENT_WINDOWS_DISK_SPACE")
    archive = out_dir / (SNAPSHOT + ".snapshot.tar.gpg")
    part = pathlib.Path(str(archive) + ".partial")
    metadata = pathlib.Path(str(archive) + ".verification.json")
    if any(p.exists() for p in (archive, part, metadata)):
        stop("ARCHIVE_ALREADY_EXISTS_NEVER_OVERWRITE")
    print("LOCAL_ENCRYPTED_SSH_TRANSFER_BEGIN=YES", flush=True)
    proc = subprocess.Popen(make_ssh_command(ssh_identity),
                            stdout=subprocess.PIPE, stderr=None)
    digest = hashlib.sha256()
    size = 0
    try:
        with open(str(part), "xb") as f:
            while True:
                buf = proc.stdout.read(CHUNK)
                if not buf:
                    break
                f.write(buf)
                digest.update(buf)
                size += len(buf)
            f.flush()
            os.fsync(f.fileno())
        proc.stdout.close()
        if proc.wait(timeout=60) != 0 or not MIN_ENCRYPTED_BYTES < size < MAX_ENCRYPTED_BYTES:
            stop("SSH_TRANSFER_INCOMPLETE_OR_SOURCE_FAILED")
        print("LOCAL_ENCRYPTED_BYTES_RECEIVED=" + str(size), flush=True)
        print("LOCAL_DECRYPT_AND_ORIGINAL_SHA256_TEST_BEGIN=YES", flush=True)
        proof = verify_archive(part, local_key, digest.hexdigest())
        os.replace(str(part), str(archive))
        record = {"schema": "prhm.owner-offnode-encrypted-snapshot.v1",
                  "snapshot": SNAPSHOT, "source_git_release": APPROVED_RELEASE_SHA,
                  "local_sha256": digest.hexdigest(), "encrypted_size": size,
                  "verified_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  "owner_windows_sha256_verified": True,
                  "decrypted_full_archive_sha256_verified": True,
                  "google_drive_uploaded": False, "google_drive_redownload_verified": False}
        record.update(proof)
        with open(str(metadata), "x", encoding="utf-8") as f:
            json.dump(record, f, indent=2, sort_keys=True)
        print("OWNER_OFFNODE_ENCRYPTED_BACKUP=PASS", flush=True)
        print("ENCRYPTED_ARCHIVE=" + str(archive), flush=True)
        print("ENCRYPTED_SHA256=" + digest.hexdigest(), flush=True)
        print("META_RECORD=" + str(metadata), flush=True)
    except BaseException:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
        if part.exists():
            part.unlink()
        raise


def verify(args):
    assert_owner_windows()
    key_dir, _ = owner_paths()
    local_key = check_receipt(key_dir)
    path = pathlib.Path(args.file).expanduser().resolve()
    if not path.is_file() or path.is_symlink():
        stop("ENCRYPTED_ARCHIVE_MISSING")
    expected = args.expected_sha256
    proof = verify_archive(path, local_key, expected)
    print("DECRYPTED_ORIGINAL_SNAPSHOT_SHA256=PASS")
    print("DATABASE_COUNT=" + str(proof["database_count"]))
    print("SITE_FILES=" + str(proof["site_regular_files"]))
    print("ENCRYPTED_SHA256=" + sha_file(path))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    modes = p.add_subparsers(dest="action")
    modes.required = True
    modes.add_parser("fetch", help="read-only SSH stream of encrypted archive to owner's Windows PC")
    v = modes.add_parser("verify", help="verify an independently downloaded ciphertext")
    v.add_argument("--file", required=True)
    v.add_argument("--expected-sha256")
    args = p.parse_args()
    try:
        if args.action == "fetch":
            fetch()
        else:
            verify(args)
    except (OSError, RuntimeError, ValueError, tarfile.TarError,
            subprocess.SubprocessError, KeyError, json.JSONDecodeError) as e:
        # Never echo secret bytes or remote SSH credential.
        print("OWNER_OFFSITE_EXPORT_BLOCKED=" + type(e).__name__, file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
