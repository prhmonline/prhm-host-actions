#!/usr/bin/env python3
"""Offline/synthetic fixed supervisor contracts. No production writes."""
import datetime
import importlib.util
import json
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
SOURCE = HERE / 'node1-hostdata-supervisor-v1.py'
spec = importlib.util.spec_from_file_location('node1_supervisor', str(SOURCE))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
UTC = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 10, 18, 0, 0, tzinfo=UTC)


def report(age=1, status='PASS'):
    return {'status': status, 'runner_exit_code': 0 if status == 'PASS' else 8,
            'finished_utc': (NOW - datetime.timedelta(hours=age)).isoformat(),
            'snapshot_sha256_verified': status == 'PASS',
            'coverage_ratio': 1 if status == 'PASS' else 0,
            'database_count': 6 if status == 'PASS' else 0,
            'snapshot': '20261010T163143Z' if status == 'PASS' else ''}


class FixedContracts(unittest.TestCase):
    def test_fresh_good_result_accepted_with_no_false_offsite(self):
        r = mod.classify_last(report(), NOW, 426 * 1024 ** 3)
        self.assertTrue(r['ok'])
        self.assertFalse(r['independent_physical_offsite'])
        self.assertFalse(r['live_vm_backup'])

    def test_missed_backup_stale_37_hours(self):
        r = mod.classify_last(report(age=37), NOW, 426 * 1024 ** 3)
        self.assertFalse(r['ok'])
        self.assertFalse(r['checks']['fresh_within_36h'])

    def test_latest_failure_not_hidden_by_prior_success(self):
        r = mod.classify_last(report(status='FAIL'), NOW, 426 * 1024 ** 3)
        self.assertFalse(r['ok'])
        self.assertFalse(r['checks']['result_pass'])

    def test_disk_critical_fails_and_warning_not_silent(self):
        fail = mod.classify_last(report(), NOW, 63 * 1024 ** 3)
        warn = mod.classify_last(report(), NOW, 90 * 1024 ** 3)
        self.assertFalse(fail['ok'])
        self.assertTrue(warn['ok'])
        self.assertTrue(warn['disk_warning_below_96gib'])

    def test_bad_proof_rejected(self):
        x = report()
        x['snapshot_sha256_verified'] = False
        x['coverage_ratio'] = 0
        x['database_count'] = 0
        self.assertFalse(mod.classify_last(x, NOW, 426 * 1024 ** 3)['ok'])

    def test_timestamps_parse_python36_format_with_colon(self):
        # Node1 Python 3.6 supports %z only as +HHMM; module normalizes +HH:MM.
        self.assertTrue(mod.classify_last(report(), NOW, 426 * 1024 ** 3)['ok'])

    def test_manifest_and_snapshot_pure_synthetic(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = pathlib.Path(tmp)
            root = base / 'snapshots'
            root.mkdir()
            snap = root / '20261010T163143Z'
            (snap / 'db').mkdir(parents=True)
            (snap / 'files').mkdir()
            (snap / 'COMPLETE').touch()
            values = [('schema','prhm.node1-hostdata-snapshot.v1'),
                      ('host','server1.prhm.ir'), ('created_utc',snap.name),
                      ('vm_disk_backup_proven','false'),
                      ('offsite_independence_proven','false'),
                      ('coverage','host_db_and_site_files_only')]
            (snap / 'MANIFEST').write_text(
                ''.join('{}={}\n'.format(k,v) for k,v in values))
            (snap / 'db/database_names.txt').write_text(
                '\n'.join('database_{}'.format(i) for i in range(6)))
            (snap / 'files/coverage-proof.json').write_text(
                json.dumps({'ok':True,'ratio':1.0,'site_regular_files':109828,
                            'archived_site_logical_bytes':4280316096}))
            prev = mod.ROOT
            try:
                mod.ROOT = root
                started = datetime.datetime(2026,10,10,16,31,43,tzinfo=UTC)
                proof = mod.verify_snapshot(snap, started, checksum_command=False)
                self.assertEqual(proof['database_count'],6)
                self.assertEqual(proof['site_regular_files'],109828)
                (snap / 'files/coverage-proof.json').write_text(
                    json.dumps({'ok':False,'ratio':0.0,'site_regular_files':0,
                                'archived_site_logical_bytes':0}))
                with self.assertRaises(ValueError):
                    mod.verify_snapshot(snap, started, checksum_command=False)
            finally:
                mod.ROOT = prev

    def test_units_do_not_prune_or_claim_offsite(self):
        root = HERE.parent / 'systemd'
        svc = (root/'prhm-node1-hostdata-backup.service').read_text()
        timer = (root/'prhm-node1-hostdata-backup.timer').read_text()
        guard = (root/'prhm-node1-hostdata-health.service').read_text()
        watch = (root/'prhm-node1-hostdata-health.timer').read_text()
        self.assertIn('ExecStart=/usr/local/sbin/prhm-node1-hostdata-supervisor --run',svc)
        self.assertIn('03:30:00 Asia/Tehran',timer)
        self.assertIn('08:30:00 Asia/Tehran',watch)
        self.assertIn('--check',guard)
        self.assertIn('ProtectHome=read-only',svc)
        self.assertIn('ProtectSystem=strict',svc)
        self.assertIn('RandomizedDelaySec=15min',timer)
        for s in (svc,timer,guard,watch):
            for banned in ('prune','forget','rm -rf','qemu-img','virsh','rclone'):
                self.assertNotIn(banned,s)

    def test_no_arbitrary_run_modes(self):
        self.assertNotIn('subprocess.Popen(', SOURCE.read_text())
        self.assertIn("['--check']", SOURCE.read_text())
        self.assertIn("['--preflight']", SOURCE.read_text())


if __name__ == '__main__':
    unittest.main()
