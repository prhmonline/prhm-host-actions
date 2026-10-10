#!/usr/bin/env python3
"""No-provider-write tests for encrypted cloud backup release candidate."""
import hashlib
import os
import pathlib
import subprocess
import tarfile
import tempfile
import unittest

ROOT=pathlib.Path(__file__).resolve().parent
SCRIPT=ROOT/'node1-hostdata-gdrive-one-shot-v1.sh'


class CloudBackupContracts(unittest.TestCase):
    def test_bash_syntax(self):
        p=subprocess.run(['/usr/bin/bash','-n',str(SCRIPT)],timeout=5)
        self.assertEqual(p.returncode,0)

    def test_unknown_mode_refuses_to_run(self):
        p=subprocess.run(['/usr/bin/bash',str(SCRIPT),'--delete'],stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE,timeout=5)
        self.assertEqual(p.returncode,3)
        self.assertIn(b'FIXED_MODES_ONLY',p.stderr)

    def test_no_plaintext_cloud_writes(self):
        s=SCRIPT.read_text()
        self.assertIn('--symmetric --cipher-algo AES256',s)
        self.assertIn('--passphrase-file "$PASSPHRASE"',s)
        self.assertIn('copyto "$local_encrypted" "$remote_object"',s)
        self.assertNotIn('copyto "$stage/restored"',s)
        self.assertNotIn('copyto "$NODE_ROOT"',s)
        self.assertNotIn('rclone sync',s)
        self.assertNotIn(' --delete',s)

    def test_guard_missing_escrow_or_inaccessible_cloud_folder(self):
        s=SCRIPT.read_text()
        self.assertIn('independent_physical_copy_confirmed',s)
        self.assertIn("data.get('confirmed_by')!='owner'",s)
        self.assertIn('len(secret)<48',s)
        self.assertIn('REMOTE_FOLDER_OR_INVENTORY_UNAVAILABLE',s)
        self.assertIn('REMOTE_OBJECT_ALREADY_EXISTS',s)
        self.assertIn('REMOTE_QUOTA_INSUFFICIENT',s)
        self.assertIn('LOCAL_CAPACITY_INSUFFICIENT',s)
        self.assertIn('INVALID_SNAPSHOT_ID',s)
        self.assertIn('RELEASE_SHA_FILE',s)
        self.assertIn("commit_sha':commit_sha",s)

    def test_cloud_restore_must_validate_all_snapshot_sha_and_coverage(self):
        s=SCRIPT.read_text()
        self.assertIn('cmp -s "$local_encrypted" "$local_received"',s)
        self.assertIn('sha256sum -c SHA256SUMS',s)
        self.assertIn("proof.get('ratio',0)<.95",s)
        self.assertIn("len(names)<6",s)
        self.assertIn('FULL_VM_BACKUP_PROVEN=NO',s)
        for forbidden in ['restic prune','rclone purge','virsh','qemu-img','gcloud']:
            self.assertNotIn(forbidden,s)

    def test_approved_google_account_binding_and_fail_closed_order(self):
        code=SCRIPT.read_text()
        self.assertIn("EXPECTED_ACCOUNT='prhmonline@gmail.com'",code)
        self.assertIn("fields=user(emailAddress)",code)
        self.assertIn("DESTINATION_ACCOUNT_MISMATCH",code)
        self.assertIn("DESTINATION_IDENTITY_API_UNAVAILABLE",code)
        self.assertIn("DESTINATION_ACCOUNT_BOUND=PASS",code)
        self.assertIn("DESTINATION_ACCOUNT_NOT_VERIFIED",code)
        self.assertIn("configparser.ConfigParser(interpolation=None)",code)
        self.assertIn("urllib.request.Request(",code)
        run=code[code.index('run_backup(){'):]
        self.assertLess(run.index('verify_destination_identity'),run.index('require_key_escrow'))
        self.assertLess(run.index('verify_destination_identity'),run.index('rclone_read --transfers'))

    def test_real_synthetic_aes256_openpgp_encrypt_restore_and_tamper(self):
        if not os.path.exists('/usr/bin/gpg'):
            self.skipTest('GnuPG unavailable on test machine')
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t)
            snap=root/'20261010T180405Z'
            (snap/'db').mkdir(parents=True)
            (snap/'files').mkdir()
            (snap/'COMPLETE').touch()
            (snap/'db'/'database_names.txt').write_text(
                '\n'.join('database_{}'.format(i) for i in range(6)))
            (snap/'db'/'fixture.sql.gz').write_bytes(os.urandom(8192))
            (snap/'files'/'coverage-proof.json').write_text(
                '{"ok":true,"ratio":1.0,"site_regular_files":109828}')
            names=['COMPLETE','db/database_names.txt','db/fixture.sql.gz',
                   'files/coverage-proof.json']
            checks=[]
            for n in names:
                f=snap/n
                checks.append('{}  {}'.format(hashlib.sha256(f.read_bytes()).hexdigest(),n))
            (snap/'SHA256SUMS').write_text('\n'.join(checks)+'\n')
            plaintext=root/'fixture.tar'
            with tarfile.open(plaintext,'w') as tfile:
                tfile.add(snap,arcname=snap.name)
            secret=root/'passphrase'
            secret.write_bytes(os.urandom(64).hex().encode('ascii'))
            encrypted=root/'fixture.tar.gpg'
            g=['/usr/bin/gpg','--batch','--yes','--no-tty','--pinentry-mode','loopback',
               '--passphrase-file',str(secret)]
            result=subprocess.run(g+['--symmetric','--cipher-algo','AES256',
                                    '--compress-algo','none','--s2k-digest-algo','SHA256',
                                    '--output',str(encrypted),str(plaintext)],
                                  stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
            self.assertEqual(result.returncode,0)
            self.assertNotIn(b'database_names',encrypted.read_bytes())
            restore=root/'restored'
            restore.mkdir()
            decoded=root/'decoded.tar'
            result=subprocess.run(g+['--output',str(decoded),'--decrypt',str(encrypted)],
                                  stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
            self.assertEqual(result.returncode,0)
            with tarfile.open(decoded,'r') as tr:
                tr.extractall(restore)
            p=restore/snap.name
            for line in (p/'SHA256SUMS').read_text().splitlines():
                checksum,name=line.split('  ',1)
                self.assertEqual(checksum,hashlib.sha256((p/name).read_bytes()).hexdigest())
            bad=root/'tampered.gpg'
            bits=bytearray(encrypted.read_bytes())
            bits[len(bits)//2]^=1
            bad.write_bytes(bits)
            failed=subprocess.run(g+['--output',str(root/'corrupted.tar'),
                                     '--decrypt',str(bad)],stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL,timeout=15)
            self.assertNotEqual(failed.returncode,0)


if __name__=='__main__':
    unittest.main()
