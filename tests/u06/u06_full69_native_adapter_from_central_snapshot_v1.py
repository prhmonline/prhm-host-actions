#!/usr/bin/env python3
"""U06 fixed native adapter integration on disposable MariaDB, no live apply.

Runs the ACTUAL installed Universal database.py backup_database() and
verify_database_restore(), proves a scoped account and credential setup,
full independent SQL restore, table check, finance aggregates, offsite flag
change and rollback of the disposable account/credential/profile.

This program has exactly one CLI mode: --isolated-fixture. It has NO live
production mutation path or command/host/database/file path parameters.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import stat
import subprocess
import sys
import tempfile
import uuid

PINNED_IMAGE = (
    "mariadb@sha256:"
    "114d40be36852d0a019afd8458f7e1cc63fd300403b115b1f32e31130d5f671b"
)
ADAPTER_DIR = "/usr/local/libexec/deploy-control/universal/current"
ROOT = Path("/var/tmp")
ACTUAL_PROFILE = Path("/etc/deploy-control/projects/honartik_back.production.json")
EXPECTED_SHA = "79783874cb5170eec3dedcc536f713c4567c585e118f881c1035862a7bba8698"
TEST_USER = "u06_sandbox_backup"
CENTRAL_SNAPSHOT = Path(
    "/var/backups/prhm-central/20261111T092019Z/"
    "db/prhm-mariadb/honartik_db.sql.gz"
)
SNAPSHOT_SHA256 = (
    "5adf9397c2cbc8045d29ef7b11bd34ab17ed26a4920106a79f036fa24e85de15"
)
FINANCE_QUERY = {
    "finance_transactions": "SELECT COUNT(*),COALESCE(SUM(amount),0) FROM honartik_db.finance_transactions",
    "finance_wallet": "SELECT COUNT(*),COALESCE(SUM(amount),0) FROM honartik_db.finance_wallet",
    "reserve": "SELECT COUNT(*),COALESCE(SUM(id),0) FROM honartik_db.reserve",
    "reserve_item": "SELECT COUNT(*),COALESCE(SUM(price),0) FROM honartik_db.reserve_item",
    "iticket_reservation": "SELECT COUNT(*),COALESCE(SUM(total_amount),0) FROM honartik_db.iticket_reservation",
    "finance_offline_pay": "SELECT COUNT(*),COALESCE(SUM(id),0) FROM honartik_db.finance_offline_pay",
}



def run(argv, *, inp=None, timeout=120):
    p = subprocess.run(
        argv, input=inp, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout
    )
    if p.returncode:
        raise RuntimeError("isolated_command_failed_" + str(argv[0:2]) + "_" + str(p.returncode))
    return p.stdout.decode(errors="replace").strip()


def syncdir(p):
    fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def put_atomic(path, data):
    path = Path(path)
    tmp = path.with_name(path.name + ".pending")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        if os.write(fd, data) != len(data):
            raise OSError("short_write")
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(tmp, path)
    syncdir(path.parent)


def check_db(name, sql):
    return run(["docker", "exec", name, "mariadb", "-uroot",
                "--batch", "--skip-column-names", "-e", sql], timeout=30)



def snapshot_sha256(path):
    h=hashlib.sha256()
    with path.open("rb") as file:
        while True:
            buf=file.read(1024 * 1024)
            if not buf: break
            h.update(buf)
    return h.hexdigest()


def attest_central_snapshot():
    st=CENTRAL_SNAPSHOT.lstat()
    assert stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_gid==0
    assert stat.S_IMODE(st.st_mode)==0o600 and st.st_nlink==1
    assert snapshot_sha256(CENTRAL_SNAPSHOT)==SNAPSHOT_SHA256
    with gzip.open(CENTRAL_SNAPSHOT,"rb") as stream:
        assert len(stream.read(200))==200


def import_compressed_snapshot(name):
    proc=subprocess.Popen(
        ["docker","exec","-i",name,"mariadb","-uroot"],
        stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL
    )
    try:
        with gzip.open(CENTRAL_SNAPSHOT,"rb") as stream:
            while True:
                buf=stream.read(1024 * 1024)
                if not buf:break
                proc.stdin.write(buf)
        proc.stdin.close()
        assert proc.wait(timeout=600)==0
    finally:
        if proc.poll() is None:
            proc.kill();proc.wait()


def finance_snapshot(name):
    return {key:check_db(name,query) for key,query in FINANCE_QUERY.items()}


def real_schema(name):
    tables=check_db(name,"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='honartik_db' AND table_type='BASE TABLE'")
    fks=check_db(name,"SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema='honartik_db'")
    return int(tables),int(fks)


def bounded_docker(name, socket_dir=None):
    cmd = ["docker", "run", "-d", "--name", name, "--network=none",
           "--memory=2g", "--cpus=1.5", "--pids-limit=256",
           "--security-opt=no-new-privileges", "--label", "prhm.u06.sandbox=1"]
    if socket_dir:
        cmd.extend(["--mount", "type=bind,src=" + str(socket_dir) + ",dst=/run/mysqld"])
    cmd.extend(["-e", "MYSQL_ALLOW_EMPTY_PASSWORD=yes", PINNED_IMAGE])
    run(cmd, timeout=90)


def scenario(fault_after_credential=False):
    if not Path(ADAPTER_DIR, "universal", "adapters", "database.py").is_file():
        raise RuntimeError("installed_universal_adapter_unavailable")
    sys.path.insert(0, ADAPTER_DIR)
    from universal.adapters.database import (
        backup_database, verify_database_restore, wait_for_final_sandbox_server
    )
    with tempfile.TemporaryDirectory(prefix="prhm-u06-full69-native-test-", dir=ROOT) as td:
        work = Path(td)
        work.chmod(0o700)
        profile = work / "honartik_back.production.json"
        original = b'{"project":"honartik_back","backup":{"offsite_required":false}}\n'
        put_atomic(profile, original)
        sock = work / "mysql-socket"
        sock.mkdir(mode=0o777)
        os.chmod(sock, 0o777)  # MariaDB Docker uid must create socket.
        name = "u06-actual-native-" + uuid.uuid4().hex[:9]
        restored = "u06-independent-restore-" + uuid.uuid4().hex[:9]
        backup_user_exists = False
        mysql_container_alive = False
        restore_container_alive = False
        credential = work / "mysql.cnf"
        journal = work / "journal.json"
        completed = False
        outcome = {}
        try:
            bounded_docker(name, sock)
            mysql_container_alive = True
            wait_for_final_sandbox_server(name, False)
            import_compressed_snapshot(name)
            assert real_schema(name)==(69,49)
            restored_source_finance=finance_snapshot(name)
            # The scope lives only in a networkless, throwaway MariaDB.
            pwd = secrets.token_urlsafe(48)
            create = (
                "CREATE USER '" + TEST_USER + "'@'localhost' IDENTIFIED BY '" + pwd + "';"
                "GRANT SELECT, SHOW VIEW, TRIGGER, EVENT "
                "ON honartik_db.* TO '" + TEST_USER + "'@'localhost';"
            )
            run(["docker", "exec", "-i", name, "mariadb", "-uroot"],
                inp=create.encode(), timeout=35)
            backup_user_exists = True
            journal_data = json.dumps({
                "schema": "prhm.u06.isolated.native-journal.v1",
                "original_profile_sha256": hashlib.sha256(original).hexdigest(),
                "original_profile_b64": __import__("base64").b64encode(original).decode(),
                "state": "PREPARED",
                "native_account": TEST_USER,
            }, sort_keys=True).encode()
            put_atomic(journal, journal_data)
            options = (
                "[client]\nuser=" + TEST_USER + "\npassword=" + pwd +
                "\nprotocol=socket\nsocket=" + str(sock / "mysqld.sock") + "\n"
            )
            put_atomic(credential, options.encode())
            del pwd, options, create
            assert stat.S_IMODE(credential.stat().st_mode) == 0o600
            if fault_after_credential:
                raise RuntimeError("expected_failure_after_disposable_credential")
            cfg = {
                "id": "main", "adapter": "mysql", "name": "honartik_db",
                "host": "localhost", "port": 3306,
                "connection_file": str(credential),
                "sandbox": {"image": PINNED_IMAGE},
            }
            manifest = backup_database(cfg, work / "native")
            archive = Path(manifest["path"])
            assert archive.is_file() and archive.stat().st_size > 100
            assert hashlib.sha256(archive.read_bytes()).hexdigest() == manifest["sha256"]
            native = verify_database_restore(cfg, manifest, work / "native-verified")
            assert native["verified"] is True and native["tables"] == 69
            bounded_docker(restored)
            restore_container_alive = True
            wait_for_final_sandbox_server(restored, False)
            run(["docker", "exec", restored, "mariadb", "-uroot", "-e",
                 "CREATE DATABASE honartik_db"], timeout=25)
            imp = subprocess.Popen(
                ["docker", "exec", "-i", restored, "mariadb", "-uroot", "honartik_db"],
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            with archive.open("rb") as probe:
                magic = probe.read(2)
            with (gzip.open(archive, "rb") if magic == bytes.fromhex("1f8b") else archive.open("rb")) as sql:
                while True:
                    chunk = sql.read(64 * 1024)
                    if not chunk:
                        break
                    imp.stdin.write(chunk)
            imp.stdin.close()
            assert imp.wait(timeout=600) == 0
            checked = subprocess.run(
                ["docker", "exec", restored, "mariadb-check", "-uroot", "--check", "honartik_db"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=300
            )
            assert checked.returncode == 0
            amounts = check_db(restored,
                "SELECT COUNT(*), SUM(amount) FROM honartik_db.finance_transactions")
            wallets = check_db(restored,
                "SELECT COUNT(*), SUM(amount) FROM honartik_db.finance_wallet")
            reserves = check_db(restored, "SELECT COUNT(*) FROM honartik_db.reserve")
            constraints = check_db(restored, "SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='honartik_db'")
            assert real_schema(restored)==(69,49)
            assert finance_snapshot(restored)==restored_source_finance
            assert constraints=="49"
            put_atomic(profile, b'{"project":"honartik_back","backup":{"offsite_required":true}}\n')
            assert json.loads(profile.read_text())["backup"]["offsite_required"] is True
            completed = True
            outcome = {
                "native_adapter_backup_called": True,
                "native_adapter_restore_verified": True,
                "full_independent_mysqlcheck": True,
                "finance_aggregate_unchanged": True,
                "wallet_and_reserve_verified": True,
                "foreign_key_verified": True,
                "offsite_profile_fixture_enabled": True,
                "native_backup_sha256": manifest["sha256"],
                "native_backup_bytes": archive.stat().st_size,
                "fixture_table_count": 69,
                "fixture_fk_count": 49,
                "six_finance_aggregate_parity_verified": True,
                "finance_table_names": sorted(FINANCE_QUERY),
                "source_snapshot_sha256": SNAPSHOT_SHA256,
                "source_snapshot_origin": "central_snapshot_not_native_live",
                "production_database_connected": False,
            }
        except RuntimeError as error:
            if fault_after_credential and str(error) == "expected_failure_after_disposable_credential":
                outcome = {
                    "injected_failure_triggered": True,
                    "native_backup_skipped": True,
                }
            else:
                raise
        finally:
            # Roll back all reversible, sandbox-only mutations.
            if backup_user_exists and mysql_container_alive:
                run(["docker", "exec", name, "mariadb", "-uroot", "-e",
                     "DROP USER IF EXISTS '" + TEST_USER + "'@'localhost'"], timeout=30)
                present = check_db(name,
                    "SELECT COUNT(*) FROM mysql.user WHERE user='" + TEST_USER + "'")
                assert present == "0"
                outcome["test_account_rolled_back"] = True
            if credential.exists():
                credential.unlink()
                syncdir(work)
            put_atomic(profile, original)
            assert profile.read_bytes() == original
            assert stat.S_IMODE(profile.stat().st_mode) == 0o600
            outcome["fixture_profile_exact_rollback"] = True
            outcome["temporary_credential_removed"] = not credential.exists()
            if restore_container_alive:
                run(["docker", "rm", "-fv", restored], timeout=55)
            if mysql_container_alive:
                run(["docker", "rm", "-fv", name], timeout=55)
        outcome["temporary_containers_removed"] = True
        outcome["fault_mode"] = fault_after_credential
        outcome["completed_before_disposable_rollback"] = completed
        return outcome


def main():
    if sys.argv[1:] != ["--isolated-fixture"]:
        raise SystemExit("ERROR: ONLY --isolated-fixture IS SUPPORTED; NO LIVE APPLY")
    before = hashlib.sha256(ACTUAL_PROFILE.read_bytes()).hexdigest()
    if before != EXPECTED_SHA:
        raise SystemExit("ERROR: actual Production profile changed; stop isolated test")
    attest_central_snapshot()
    ok = scenario(fault_after_credential=False)
    fail = {"not_run": True, "reason": "bounded-full69-restore-no-repeated-import"}
    after = hashlib.sha256(ACTUAL_PROFILE.read_bytes()).hexdigest()
    assert before == after
    print(json.dumps({
        "schema": "prhm.u06.full69-native-universal-from-central-snapshot.v1",
        "source": "installed-universal-python-adapter_on_real_69_table_restored_central_snapshot",
        "production_profile_sha256_unchanged": True,
        "production_credentials_read": False,
        "production_database_connected": False,
        "production_database_mutated": False,
        "production_root_policy_modified": False,
        "real_owner_approval_consumed": False,
        "production_release_authorized": False,
        "failure_injection": fail,
        "native_sandbox": ok,
        "result": "PASS",
    }, sort_keys=True))


if __name__ == "__main__":
    main()
