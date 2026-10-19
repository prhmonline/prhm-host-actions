#!/usr/bin/env python3
"""Fixed, read-only Node1 backup coverage audit. Python 3.6+.
Does NOT create backup files, restore, alter VM images or read user data contents.
Run remotely via SSH from a trusted control-plane worktree:
  ssh root@185.191.76.138 'python3 - --read-only' < ops/node1-backup-coverage-audit-v1.py
"""
import datetime
import gzip
import json
import os
import re
import socket
import subprocess
import sys
import tarfile

HOST = 'server1.prhm.ir'
ROOT = '/var/backups/prhm-node1-full'
IMOTION_DOMAINS = '/home/imotion/domains'
EXPECTED_DB_COUNT = 6
VMS = {
    'prhm-production': '/var/lib/libvirt/images/prhm-production.qcow2',
    'imotion-directadmin': '/var/lib/libvirt/images/imotion-directadmin.qcow2',
}
FRESH_HOURS = 24


def assess(record):
    """Fail-closed evidence gate; no success if VM, site files, or offsite absent."""
    checks = {
        'fresh_within_24h': bool(record.get('snapshot_age_hours') is not None
                                 and 0 <= record['snapshot_age_hours'] <= FRESH_HOURS),
        'snapshot_checksum_integrity': record.get('checksum_pass') is True,
        'snapshot_marked_complete': record.get('complete') is True,
        'database_inventory_complete': record.get('database_inventory_count') == EXPECTED_DB_COUNT,
        'database_dump_archive_valid': record.get('database_dump_valid') is True,
        'site_content_present': (record.get('site_content_bytes', 0) > 0
                                 and record.get('archived_site_bytes', 0) >= record.get('site_content_bytes', 0) * 0.5),
        'vm_prhm_protected': record.get('vm_backup_evidence', {}).get('prhm-production') is True,
        'vm_imotion_protected': record.get('vm_backup_evidence', {}).get('imotion-directadmin') is True,
        'independent_offsite_restore_proven': record.get('independent_offsite_restore_proven') is True
    }
    missing = [k for k in checks if not checks[k]]
    return {'status': 'VERIFIED_FULL_NODE1' if not missing else 'COVERAGE_INCOMPLETE',
            'checks': checks, 'missing': missing, 'safe_to_call_fully_backed_up': not missing}


def command(argv, timeout=20):
    try:
        p = subprocess.run(argv, stdout=subprocess.PIPE,
                           stderr=subprocess.DEVNULL, universal_newlines=True,
                           timeout=timeout)
        return (p.returncode == 0, p.stdout)
    except Exception:
        return (False, '')


def site_archive_byte_count(archive):
    if not os.path.isfile(archive):
        return (False, 0, 0)
    process = None
    total, entries = 0, 0
    try:
        process = subprocess.Popen(['/usr/bin/zstd', '-dc', archive],
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        with tarfile.open(fileobj=process.stdout, mode='r|') as tf:
            for entry in tf:
                name = entry.name.lstrip('./')
                if name.startswith('home/imotion/domains/') or name == 'home/imotion/domains':
                    entries += 1
                    if entry.isfile():
                        total += entry.size
        return (process.wait(timeout=15) == 0, total, entries)
    except Exception:
        if process is not None:
            process.kill()
            process.wait()
        return (False, 0, 0)


def run():
    if socket.gethostname() != HOST:
        raise RuntimeError('HOST_NOT_EXPECTED')
    if not os.path.isdir(ROOT):
        raise RuntimeError('BACKUP_ROOT_MISSING')
    now = datetime.datetime.now(datetime.timezone.utc)
    snaps = sorted((name for name in os.listdir(ROOT)
                    if re.match(r'^20[0-9]{6}T[0-9]{6}Z$', name)
                    and os.path.isdir(os.path.join(ROOT, name))), reverse=True)
    path = os.path.join(ROOT, snaps[0]) if snaps else None
    record = {'host': HOST, 'snapshot': snaps[0] if snaps else None, 'snapshot_age_hours': None,
              'complete': False, 'checksum_pass': False,
              'database_inventory_count': None, 'database_dump_valid': False,
              'site_content_bytes': 0, 'archived_site_bytes': 0,
              'archive_site_entries': 0, 'vm_source_allocated_bytes': {},
              'vm_backup_evidence': {name: False for name in VMS},
              'independent_offsite_restore_proven': False}
    if path:
        complete = os.path.join(path, 'COMPLETE')
        record['complete'] = os.path.isfile(complete)
        ts = datetime.datetime.strptime(snaps[0], '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc)
        record['snapshot_age_hours'] = round((now-ts).total_seconds()/3600.0, 1)
        if os.path.isfile(os.path.join(path, 'SHA256SUMS')):
            # Run checksum verification with fixed cwd, no file listing emitted.
            p = subprocess.run(['/usr/bin/sha256sum', '-c', 'SHA256SUMS'],
                               cwd=path, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=35)
            record['checksum_pass'] = p.returncode == 0
        db = os.path.join(path, 'db/all-databases.sql.gz')
        if os.path.isfile(db):
            ok, _ = command(['/usr/bin/gzip', '-t', db], timeout=25)
            record['database_dump_valid'] = ok
        valid, bytes_used, entries = site_archive_byte_count(os.path.join(path,'files/home.tar.zst'))
        record['archived_site_bytes'] = bytes_used if valid else 0
        record['archive_site_entries'] = entries if valid else 0
    ok, out = command(['/usr/bin/mariadb', '-NBe',
                       "SELECT COUNT(*) FROM information_schema.SCHEMATA "
                       "WHERE SCHEMA_NAME NOT IN "
                       "('information_schema','mysql','performance_schema','sys')"], timeout=15)
    if ok:
        try: record['database_inventory_count'] = int(out.strip())
        except ValueError: pass
    ok, out = command(['/usr/bin/du', '-sb', IMOTION_DOMAINS], timeout=20)
    if ok:
        try: record['site_content_bytes'] = int(out.split()[0])
        except Exception: pass
    for name, source in VMS.items():
        try:
            st = os.stat(source)
            record['vm_source_allocated_bytes'][name] = st.st_blocks * 512
        except OSError:
            record['vm_source_allocated_bytes'][name] = None
    verdict = assess(record)
    return {'schema': 'prhm.node1-backup-coverage-audit.v1',
            'read_only': True, 'production_mutation': False,
            'audit_utc': now.isoformat(), 'record': record, 'verdict': verdict}


if __name__ == '__main__':
    if sys.argv[1:] != ['--read-only']:
        sys.stderr.write('READ_ONLY_ONLY\n')
        sys.exit(2)
    try:
        output = run()
        print(json.dumps(output, sort_keys=True))
        sys.exit(0 if output['verdict']['safe_to_call_fully_backed_up'] else 3)
    except Exception:
        print(json.dumps({'schema':'prhm.node1-backup-coverage-audit.v1',
                          'status':'AUDIT_FAILED_CLOSED', 'read_only':True,
                          'production_mutation':False}))
        sys.exit(4)
