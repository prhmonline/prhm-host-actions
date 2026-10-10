#!/usr/bin/env python3
"""Owner-only, OFF-SERVER key generation and recovery drill for Node1 encrypted backups.

Never run on Node1 or prhm-production. Never paste the secret into chat, tickets,
Git, cloud metadata, shell history or logs. Run on an independently retained device.

create  --directory <private-new-directory>
attest  --directory <same-private-directory> --recovered-file <separately-retrieved-key-file>

Only the owner manually determines whether the second key file was recovered from
a different failure domain; this script cannot independently prove physical custody.
"""
import argparse
import datetime
import hashlib
import hmac
import json
import os
import pathlib
import secrets
import shutil
import socket
import subprocess
import sys

KEY_FILE = "node1-hostdata-gpg.passphrase"
RECEIPT_FILE = "node1-hostdata-escrow.json"
SCHEMA = "prhm.offsite-key-escrow.v1"
BLOCKED_HOSTS = ("prhm-production", "server1.prhm.ir", "node1")


def assert_off_server(hostname=None):
    name = (hostname if hostname is not None else socket.getfqdn()).lower().strip()
    if any(blocked in name for blocked in BLOCKED_HOSTS):
        raise ValueError("REFUSE_ON_NODE1_OR_PRODUCTION_HOST")
    return name


def now_utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def private_file_create(filename, content):
    flags = os.O_CREAT | os.O_WRONLY | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(str(filename), flags, 0o600)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        try:
            os.unlink(str(filename))
        except OSError:
            pass
        raise
    if os.name == "posix":
        os.chmod(str(filename), 0o600)


def read_secret(filename):
    path = pathlib.Path(filename)
    if path.is_symlink() or not path.is_file():
        raise ValueError("INVALID_OR_LINKED_SECRET_FILE")
    if os.name == "posix" and (path.stat().st_mode & 0o077):
        raise ValueError("SECRET_FILE_NOT_PRIVATE")
    secret = path.read_bytes().rstrip(b"\n")
    if not (48 <= len(secret) <= 256) or b"\r" in secret or b"\n" in secret:
        raise ValueError("INVALID_SECRET_FORMAT")
    return secret


def init_key(destination):
    assert_off_server()
    root = pathlib.Path(destination).expanduser()
    root.mkdir(mode=0o700, parents=False, exist_ok=False)
    if os.name == "posix":
        os.chmod(str(root), 0o700)
    secret = secrets.token_hex(48).encode("ascii")  # 384 bits of randomness
    key = root / KEY_FILE
    private_file_create(key, secret)
    receipt = {
        "schema": SCHEMA,
        "confirmed_by": "owner",
        "independent_physical_copy_confirmed": False,
        "key_sha256": hashlib.sha256(secret).hexdigest(),
        "generated_utc": now_utc(),
        "recovery_tested_utc": None,
        "verification": "NOT_TESTED",
    }
    private_file_create(root / RECEIPT_FILE, (json.dumps(receipt, sort_keys=True, indent=2) + "\n").encode("ascii"))
    # No key/secret text appears in stdout/stderr.
    print("OFF_SERVER_KEY_CREATED=YES")
    print("KEY_FINGERPRINT_SHA256=" + receipt["key_sha256"])
    print("RECOVERY_VERIFIED=NO")
    print("Store the passphrase in your separately accessible password manager before attest.")


def gpg_drill(original_file, recovered_file):
    executable = shutil.which("gpg")
    if not executable:
        raise ValueError("GPG_NOT_INSTALLED_ON_OWNER_DEVICE")
    challenge = secrets.token_bytes(512)
    with subprocess.Popen(
        [executable, "--batch", "--no-tty", "--pinentry-mode", "loopback",
         "--passphrase-file", str(original_file), "--symmetric",
         "--cipher-algo", "AES256", "--compress-algo", "none",
         "--s2k-digest-algo", "SHA256"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    ) as encoder:
        encrypted, error = encoder.communicate(challenge, timeout=30)
    if encoder.returncode or not encrypted:
        raise ValueError("ENCRYPTION_DRILL_FAILED")
    # Verify the *separately recovered* key can decode the ciphertext.
    decoder = subprocess.run(
        [executable, "--batch", "--no-tty", "--pinentry-mode", "loopback",
         "--passphrase-file", str(recovered_file), "--decrypt"],
        input=encrypted, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=30,
    )
    if decoder.returncode or not hmac.compare_digest(decoder.stdout, challenge):
        raise ValueError("OFF_DEVICE_DECRYPT_DRILL_FAILED")
    return True


def attest_key(directory, recovered_file):
    assert_off_server()
    root = pathlib.Path(directory).expanduser().resolve()
    key = root / KEY_FILE
    receipt_path = root / RECEIPT_FILE
    recovered = pathlib.Path(recovered_file).expanduser().resolve()
    if not receipt_path.is_file() or receipt_path.is_symlink():
        raise ValueError("MISSING_OWNER_RECEIPT")
    if key.resolve() == recovered or os.path.samefile(str(key), str(recovered)):
        raise ValueError("RECOVERED_KEY_MUST_BE_SEPARATE_FILE")
    original_secret = read_secret(key)
    recovered_secret = read_secret(recovered)
    if not hmac.compare_digest(original_secret, recovered_secret):
        raise ValueError("OFF_DEVICE_RECOVERY_KEY_MISMATCH")
    receipt = json.loads(receipt_path.read_text())
    if receipt.get("schema") != SCHEMA or receipt.get("key_sha256") != hashlib.sha256(original_secret).hexdigest():
        raise ValueError("OWNER_RECEIPT_MISMATCH")
    if receipt.get("independent_physical_copy_confirmed") is True:
        raise ValueError("OWNER_RECEIPT_ALREADY_CONFIRMED")
    gpg_drill(key, recovered)
    receipt["independent_physical_copy_confirmed"] = True
    receipt["recovery_tested_utc"] = now_utc()
    receipt["verification"] = "OWNER_ATTESTED_DISTINCT_RECOVERY_AND_GPG_DECRYPTION"
    pending = root / (RECEIPT_FILE + ".pending")
    private_file_create(pending, (json.dumps(receipt, sort_keys=True, indent=2) + "\n").encode("ascii"))
    os.replace(str(pending), str(receipt_path))
    print("OFF_SERVER_RECOVERED_KEY_GPG_TEST=PASS")
    print("OWNER_ATTESTATION=REQUIRES_TRUTHFUL_OFF_NODE1_CUSTODY")
    print("KEY_FINGERPRINT_SHA256=" + receipt["key_sha256"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action")
    commands.required = True  # Python 3.6 compatible
    create = commands.add_parser("create")
    create.add_argument("--directory", required=True)
    attest = commands.add_parser("attest")
    attest.add_argument("--directory", required=True)
    attest.add_argument("--recovered-file", required=True)
    args = parser.parse_args()
    try:
        if args.action == "create":
            init_key(args.directory)
        elif args.action == "attest":
            attest_key(args.directory, args.recovered_file)
    except (ValueError, OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        # Deliberately never include the secret or raw provider response.
        print("OFFSERVER_ESCROW_FAILED=" + type(exc).__name__, file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
