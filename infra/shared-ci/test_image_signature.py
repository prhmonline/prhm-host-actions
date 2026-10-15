"""Offline Ubuntu vendor trust status-parser contract (without GPG or network)."""
import importlib.util
import pathlib
import unittest
from unittest.mock import patch
ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('image_signature', ROOT / 'image-signature.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
FPR = mod.UBUNTU_CLOUD_IMAGE_SIGNER

class ImageSignatureTests(unittest.TestCase):
    def test_exact_ubuntu_signer_is_accepted(self):
        status = '[GNUPG:] VALIDSIG ' + FPR + ' 2026-10-14 0 4 0 1 8 00 ' + FPR
        self.assertTrue(mod.valid_signature_status(status, FPR))

    def test_subkey_primary_id_supported(self):
        status = '[GNUPG:] VALIDSIG ' + 'A'*40 + ' 2026-10-14 0 4 0 1 8 00 ' + FPR
        self.assertTrue(mod.valid_signature_status(status, FPR))

    def test_invalid_or_mismatched_signature_denied(self):
        self.assertFalse(mod.valid_signature_status('[GNUPG:] BADSIG '+FPR, FPR))
        self.assertFalse(mod.valid_signature_status('[GNUPG:] VALIDSIG ' + 'F'*40, FPR))
        self.assertFalse(mod.valid_signature_status('[GNUPG:] VALIDSIG ' + FPR, ''))
        self.assertFalse(mod.valid_signature_status('VALIDSIG ' + FPR, FPR))

    def test_unapproved_keyring_fails_before_gpg_execution(self):
        conf = {'image': {'vendor_keyring': None, 'expected_signer_fingerprint': FPR}}
        with patch.object(mod.subprocess, 'run') as run:
            ok, reason = mod.verify(conf)
            self.assertFalse(ok)
            self.assertIn('keyring', reason)
            run.assert_not_called()

    def test_wrong_signer_fails_before_gpg_execution(self):
        conf = {'image': {'vendor_keyring': '/etc/prhm-ci/trust/fake.gpg',
                          'expected_signer_fingerprint': 'A'*40}}
        with patch.object(mod.subprocess, 'run') as run:
            ok, reason = mod.verify(conf)
            self.assertFalse(ok)
            self.assertIn('fingerprint', reason)
            run.assert_not_called()

if __name__ == '__main__':
    unittest.main()
