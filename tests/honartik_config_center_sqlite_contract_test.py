#!/usr/bin/env python3
"""Isolated, real SQLite integration checks for Honartik enrollment SQL invariants.

No production connection, no external packages or credentials. This exercises
relational constraints, independent database connections, one-time issuance,
token-hash-specific revocation and failed transaction atomicity. It does NOT
execute the Laravel Eloquent code or prove MySQL's SELECT ... FOR UPDATE semantics.
"""
import hashlib
import pathlib
import re
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager

SOURCE = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "honartik-config-center-prod-enroll-20261012.php"
SITE_ID = 3
NAME = "Honartik Backend Readonly Production 20261012"
TOKEN_A = "ccm_" + "1" * 64
TOKEN_B = "ccm_" + "2" * 64


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE sites (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    config_revision INTEGER NOT NULL
);
CREATE TABLE machine_credentials (
    id INTEGER PRIMARY KEY,
    site_id INTEGER NOT NULL REFERENCES sites(id),
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    scopes TEXT NOT NULL,
    revoked_at TEXT DEFAULT NULL
);
CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    site_id INTEGER NOT NULL REFERENCES sites(id),
    action TEXT NOT NULL,
    subject_id INTEGER NOT NULL,
    metadata TEXT NOT NULL
);
INSERT INTO sites (id,slug,status,config_revision)
VALUES (3,'honartik','active',1),(4,'other','active',1);
"""


class IsolatedCredentialDB:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix="honartik-cc-sqlite-")
        self.path = str(pathlib.Path(self.temp.name) / "credential-contract.sqlite")
        db = self.connect()
        db.executescript(SCHEMA)
        db.close()

    def close(self):
        self.temp.cleanup()

    def connect(self, timeout=0.15):
        db = sqlite3.connect(self.path, timeout=timeout, isolation_level=None)
        db.execute("PRAGMA foreign_keys=ON")
        return db

    @staticmethod
    def count_active(db, site_id=SITE_ID):
        return db.execute(
            "SELECT COUNT(*) FROM machine_credentials WHERE site_id=? AND revoked_at IS NULL",
            (site_id,),
        ).fetchone()[0]

    def issue(self, db, token, *, site_id=SITE_ID, name=NAME, scope="config:read", fail_audit=False):
        # SQLite BEGIN IMMEDIATE serializes writers; Laravel on MySQL uses
        # a Site row SELECT FOR UPDATE. This is not a DB-engine equivalence test.
        db.execute("BEGIN IMMEDIATE")
        try:
            site = db.execute(
                "SELECT slug,status,config_revision FROM sites WHERE id=?", (site_id,)
            ).fetchone()
            if site != ("honartik", "active", 1):
                raise ValueError("tenant_revision_mismatch")
            if self.count_active(db, site_id):
                raise ValueError("existing_credential")
            cursor = db.execute(
                "INSERT INTO machine_credentials(site_id,name,token_hash,scopes) VALUES (?,?,?,?)",
                (site_id, name, token_hash(token), scope),
            )
            if fail_audit:
                raise RuntimeError("synthetic_audit_write_failure")
            db.execute(
                "INSERT INTO audit_log(site_id,action,subject_id,metadata) VALUES(?,?,?,?)",
                (site_id, "machine_credential.created", cursor.lastrowid, "metadata-only"),
            )
            db.execute("COMMIT")
        except BaseException:
            db.execute("ROLLBACK")
            raise

    def revoke(self, db, token, *, site_id=SITE_ID, name=NAME):
        db.execute("BEGIN IMMEDIATE")
        try:
            record = db.execute(
                """SELECT id,scopes FROM machine_credentials
                   WHERE site_id=? AND name=? AND token_hash=? AND revoked_at IS NULL""",
                (site_id, name, token_hash(token)),
            ).fetchone()
            if record is None:
                db.execute("COMMIT")
                return 0
            if record[1] != "config:read":
                raise ValueError("unexpected_scopes")
            changed = db.execute(
                "UPDATE machine_credentials SET revoked_at='2026-10-13T00:00:00Z' WHERE id=? AND revoked_at IS NULL",
                (record[0],),
            ).rowcount
            if changed != 1:
                raise RuntimeError("revocation_race")
            db.execute(
                "INSERT INTO audit_log(site_id,action,subject_id,metadata) VALUES(?,?,?,?)",
                (site_id, "machine_credential.revoked", record[0], "metadata-only"),
            )
            db.execute("COMMIT")
            return changed
        except BaseException:
            db.execute("ROLLBACK")
            raise


class SQLiteEnrollmentContracts(unittest.TestCase):
    def setUp(self):
        self.h = IsolatedCredentialDB()
        self.db = self.h.connect()

    def tearDown(self):
        self.db.close()
        self.h.close()

    def test_issue_one_config_read_credential_and_persist_one_audit(self):
        self.h.issue(self.db, TOKEN_A)
        self.assertEqual(self.h.count_active(self.db), 1)
        self.assertEqual(self.db.execute("SELECT scopes FROM machine_credentials").fetchone()[0], "config:read")
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM audit_log").fetchone()[0], 1)
        dump = "\n".join(self.db.iterdump())
        self.assertNotIn(TOKEN_A, dump, "only the SHA256 token hash may be persisted")

    def test_duplicate_issue_with_new_token_denied(self):
        self.h.issue(self.db, TOKEN_A)
        with self.assertRaisesRegex(ValueError, "existing_credential"):
            self.h.issue(self.db, TOKEN_B)
        self.assertEqual(self.h.count_active(self.db), 1)

    def test_foreign_token_never_revoked_by_matching_name(self):
        self.h.issue(self.db, TOKEN_A)
        self.assertEqual(self.h.revoke(self.db, TOKEN_B), 0)
        self.assertEqual(self.h.count_active(self.db), 1)
        self.assertEqual(self.h.revoke(self.db, TOKEN_A), 1)
        self.assertEqual(self.h.count_active(self.db), 0)
        self.assertEqual(self.h.revoke(self.db, TOKEN_A), 0, "second attempt is idempotent")

    def test_foreign_tenant_cannot_be_issued(self):
        with self.assertRaisesRegex(ValueError, "tenant_revision_mismatch"):
            self.h.issue(self.db, TOKEN_A, site_id=4)
        self.assertEqual(self.h.count_active(self.db, 4), 0)

    def test_rollback_does_not_revoke_broader_scope(self):
        self.db.execute(
            "INSERT INTO machine_credentials(site_id,name,token_hash,scopes) VALUES (3,?,?,?)",
            (NAME, token_hash(TOKEN_A), "secrets:read"),
        )
        with self.assertRaisesRegex(ValueError, "unexpected_scopes"):
            self.h.revoke(self.db, TOKEN_A)
        self.assertEqual(self.h.count_active(self.db), 1)

    def test_audit_failure_rolls_back_issuance_atomically(self):
        with self.assertRaisesRegex(RuntimeError, "synthetic_audit_write_failure"):
            self.h.issue(self.db, TOKEN_A, fail_audit=True)
        self.assertEqual(self.h.count_active(self.db), 0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM audit_log").fetchone()[0], 0)

    def test_separate_connection_cannot_issue_while_uncommitted_writer_holds_db_lock(self):
        contender = self.h.connect(timeout=0.02)
        try:
            self.db.execute("BEGIN IMMEDIATE")
            with self.assertRaises(sqlite3.OperationalError):
                self.h.issue(contender, TOKEN_A)
            self.db.execute("ROLLBACK")
            self.h.issue(contender, TOKEN_A)
            self.assertEqual(self.h.count_active(self.db), 1)
        finally:
            contender.close()

    def test_source_php_still_uses_exact_token_hash_and_site_lock(self):
        source = SOURCE.read_text(encoding="utf-8")
        for pattern in (
            r"function revokeBoundToken\(Site \$site, string \$token\)",
            r"->where\('token_hash', hash\('sha256', \$token\)\)",
            r"->whereNull\('revoked_at'\)->lockForUpdate\(\)->first\(\)",
            r"Site::query\(\)->whereKey\(\$site->id\)->lockForUpdate\(\)->firstOrFail\(\)",
            r"where\('site_id', \$site->id\)",
            r"throw new RuntimeException\('concurrent_credential_detected'\)",
            r"revokeBoundToken\(\$site, \$token\)",
        ):
            self.assertRegex(source, pattern)

    def test_missing_binding_fails_without_name_wide_revoke(self):
        source = SOURCE.read_text(encoding="utf-8")
        self.assertNotIn("revokeByName(", source)
        self.assertIn("unbound_live_credential", source)
        self.assertIn("private_file_credential_binding_mismatch", source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
