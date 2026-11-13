"""Verify the actual Ed25519 signature gate with ephemeral test keys, no host I/O."""
import hashlib
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("prhm_ci_level4", ROOT / "level4-approval.py")
approval = importlib.util.module_from_spec(spec)
spec.loader.exec_module(approval)

SHA = "a" * 40
NFT = "b" * 64
PROD = "c" * 64
NOW = 1760400000
UUID = "123e4567-e89b-42d3-a456-426614174000"


class ActualEd25519ApprovalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        directory = pathlib.Path(self.temp.name)
        self.secret = directory / "ephemeral-only-private.pem"
        self.public = directory / "ephemeral-only-public.pem"
        self.document = directory / "statement.json"
        self.signature = directory / "statement.sig"
        subprocess.run(["openssl", "genpkey", "-algorithm", "ED25519",
                        "-out", str(self.secret)], check=True, capture_output=True)
        subprocess.run(["openssl", "pkey", "-in", str(self.secret), "-pubout",
                        "-out", str(self.public)], check=True, capture_output=True)
        self.statement = {
            "schema": 1, "operation": "stage", "host": "server1.prhm.ir",
            "git_commit": SHA, "nft_preimage_sha256": NFT,
            "prod_xml_preimage_sha256": PROD,
            "issued_at": NOW, "expires_at": NOW + 120,
            "request_id": UUID, "approval_level": "LEVEL_4_CRITICAL",
        }
        self.reset_signature()
        self.key_digest = hashlib.sha256(self.public.read_bytes()).hexdigest()
        self.patchers = [
            patch.object(approval, "BASE", directory),
            patch.object(approval, "DOC", self.document),
            patch.object(approval, "SIG", self.signature),
            patch.object(approval, "PUB", self.public),
            patch.object(approval, "check_permissions", return_value=None),
        ]
        for p in self.patchers:
            p.start()
            self.addCleanup(p.stop)

    def reset_signature(self):
        self.document.write_text(json.dumps(self.statement, sort_keys=True))
        subprocess.run(["openssl", "pkeyutl", "-sign", "-inkey", str(self.secret),
                        "-rawin", "-in", str(self.document),
                        "-out", str(self.signature)], check=True, capture_output=True)

    def verify(self, **replacements):
        arguments = dict(operation="stage", revision=SHA, nft_digest=NFT,
                         prod_xml_digest=PROD,
                         pinned_public_key_sha256=self.key_digest, now=NOW + 10)
        arguments.update(replacements)
        return approval.verify_external_level4(**arguments)

    def test_real_signature_exact_claims_pass(self):
        self.assertEqual(self.verify(), UUID)

    def test_mismatched_sha_fails_closed(self):
        with self.assertRaises(approval.ApprovalRefused):
            self.verify(revision="e" * 40)

    def test_wrong_nft_preimage_fails_closed(self):
        with self.assertRaises(approval.ApprovalRefused):
            self.verify(nft_digest="d" * 64)

    def test_wrong_public_key_pin_fails_closed(self):
        with self.assertRaises(approval.ApprovalRefused):
            self.verify(pinned_public_key_sha256="f" * 64)

    def test_modified_approved_document_cannot_validate_signature(self):
        self.document.write_text(self.document.read_text().replace("LEVEL_4_CRITICAL", "LEVEL_3_CRITICAL"))
        with self.assertRaises(approval.ApprovalRefused):
            self.verify()

    def test_time_expired_fails_closed(self):
        with self.assertRaises(approval.ApprovalRefused):
            self.verify(now=NOW + 500)

    def test_wrong_host_even_when_signed_fails_closed(self):
        self.statement["host"] = "prhm-production"
        self.reset_signature()
        with self.assertRaises(approval.ApprovalRefused):
            self.verify()

    def test_extra_fields_even_when_signed_fails_closed(self):
        self.statement["arbitrary_service"] = "approved"
        self.reset_signature()
        with self.assertRaises(approval.ApprovalRefused):
            self.verify()

    def test_unknown_level_even_when_signed_fails_closed(self):
        self.statement["approval_level"] = "LEVEL_3_PRODUCTION"
        self.reset_signature()
        with self.assertRaises(approval.ApprovalRefused):
            self.verify()

    def test_invalid_uuid_even_when_signed_fails_closed(self):
        self.statement["request_id"] = "not-one-time"
        self.reset_signature()
        with self.assertRaises(approval.ApprovalRefused):
            self.verify()

    def test_payload_array_even_when_signed_fails_closed(self):
        self.document.write_text("[]")
        subprocess.run(["openssl", "pkeyutl", "-sign", "-inkey", str(self.secret),
                        "-rawin", "-in", str(self.document),
                        "-out", str(self.signature)], check=True, capture_output=True)
        with self.assertRaises(approval.ApprovalRefused):
            self.verify()


if __name__ == "__main__":
    unittest.main()
